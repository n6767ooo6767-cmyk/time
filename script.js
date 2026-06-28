// НАСТРОЙКА ПОДКЛЮЧЕНИЯ SUPABASE
const SUPABASE_URL = "https://cfsvmuewbskyqumhkyah.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmc3ZtdWV3YnNreXF1bWhreWFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Mzg5MzMsImV4cCI6MjA5ODIxNDkzM30.O6gXrIDbi2J2-JYUYGIOSW6Zm2cb8Ib7YhldhF_3_Wk";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// БАЗА ДАННЫХ ЛОКАЦИЙ (Координаты переведены в % от ширины и высоты карты)
const geoLocations = [
    { name: "Эйфелева башня (Париж)", img: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600", pctX: 50.5, pctY: 30.2 },
    { name: "Статуя Свободы (Нью-Йорк)", img: "https://images.unsplash.com/photo-1605130284535-11dd9eedc58a?w=600", pctX: 26.5, pctY: 33.5 },
    { name: "Кремль (Москва)", img: "https://images.unsplash.com/photo-1520106212299-d99c443e45f8?w=600", pctX: 56.2, pctY: 26.4 },
    { name: "Пирамиды Гизы (Египет)", img: "https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600", pctX: 53.8, pctY: 39.5 },
    { name: "Сиднейская Опера (Австралия)", img: "https://images.unsplash.com/photo-1523413651479-797eb2e3a946?w=600", pctX: 89.2, pctY: 78.1 },
    { name: "Колизей (Рим)", img: "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600", pctX: 51.5, pctY: 32.8 },
    { name: "Бурдж-Халифа (Дубай)", img: "https://images.unsplash.com/photo-1582672060674-bc2bd808a8b5?w=600", pctX: 57.8, pctY: 42.1 }
];

let roomCode = "";
let myName = "";
let isHost = false;
let currentLocIndex = 0;

// ИНИЦИАЛИЗАЦИЯ ИГРЫ (ВХОД / СОЗДАНИЕ)
async function initGame(isRoomHost) {
    roomCode = document.getElementById('room-input').value.trim();
    myName = document.getElementById('name-input').value.trim();
    isHost = isRoomHost;

    if (!roomCode || !myName) return alert("Пожалуйста, заполните код комнаты и ваше имя!");

    if (isHost) {
        // Создатель выбирает первую случайную точку
        currentLocIndex = Math.floor(Math.random() * geoLocations.length);
        
        const { error } = await supabase.from('geo_rooms').insert([{ 
            room_code: roomCode, 
            game_state: 'guessing',
            current_location: currentLocIndex,
            players: [{ name: myName, score: 0, clickX: null, clickY: null, done: false }]
        }]);
        
        if (error) return alert("Ошибка создания комнаты. Возможно, этот код уже занят.");
    } else {
        // Подключающийся игрок скачивает текущую комнату
        let { data: room } = await supabase.from('geo_rooms').select('*').eq('room_code', roomCode).single();
        if (!room) return alert("Комната с таким кодом не найдена!");

        let updatedPlayers = room.players;
        // Защита от дублирования имен
        if (updatedPlayers.some(p => p.name === myName)) return alert("Имя уже занято в этой комнате!");
        
        updatedPlayers.push({ name: myName, score: 0, clickX: null, clickY: null, done: false });
        
        await supabase.from('geo_rooms').update({ players: updatedPlayers }).eq('room_code', roomCode);
    }

    // Переключаем экраны интерфейса
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('display-room').innerText = roomCode;
    
    if (isHost) {
        document.getElementById('host-controls').classList.remove('hidden');
    }

    // Включаем Realtime прослушивание базы данных
    connectToRealtime(roomCode);
}

// ПОДКЛЮЧЕНИЕ К КАНАЛУ СИНХРОНИЗАЦИИ
function connectToRealtime(code) {
    supabase
        .channel(`geo-live-${code}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'geo_rooms', filter: `room_code=eq.${code}` }, 
        payload => {
            updateGameUI(payload.new);
        })
        .subscribe();
}

// ОБРАБОТКА ОБНОВЛЕНИЙ И ОТРИСОВКА ИНТЕРФЕЙСА
function updateGameUI(room) {
    currentLocIndex = room.current_location;
    
    // Обновляем картинку места
    document.getElementById('target-image').src = geoLocations[currentLocIndex].img;

    // Обновляем список игроков (фишки)
    const chipsContainer = document.getElementById('players-chips');
    chipsContainer.innerHTML = '';
    
    room.players.forEach(p => {
        const chip = document.createElement('div');
        chip.className = `player-chip ${p.done ? 'ready' : ''}`;
        chip.innerText = `${p.name} (${p.score}🏆) ${p.done ? '✓' : '🤔'}`;
        chipsContainer.innerHTML += chip.outerHTML;
    });

    // Обработка смены игровых состояний
    if (room.game_state === 'results') {
        document.getElementById('game-status').innerText = "Раунд завершен! Результаты на экране.";
        displayRoundResults(room.players);
    } else if (room.game_state === 'guessing') {
        document.getElementById('game-status').innerText = "Где это находится? 🤔";
        
        // Скрываем маркер, если начался новый раунд и мы еще не сделали клик
        const me = room.players.find(p => p.name === myName);
        if (me && !me.done) {
            document.getElementById('map-pin').classList.add('hidden');
        }
    }
}

// КЛИК ПО КАРТЕ МИРА
async function onMapClick(event) {
    // Проверяем текущее состояние комнаты, чтобы нельзя было кликать во время показа результатов
    let { data: room } = await supabase.from('geo_rooms').select('game_state').eq('room_code', roomCode).single();
    if (room && room.game_state === 'results') return;

    const map = document.getElementById('world-map');
    const rect = map.getBoundingClientRect();
    
    // Рассчитываем координаты клика в процентах (для кроссплатформенности)
    const clickX = ((event.clientX - rect.left) / rect.width) * 100;
    const clickY = ((event.clientY - rect.top) / rect.height) * 100;

    // Ставим пин на миникарту локально
    const pin = document.getElementById('map-pin');
    pin.classList.remove('hidden');
    pin.style.left = `${clickX}%`;
    pin.style.top = `${clickY}%`;

    // Загружаем данные из облака, обновляем свой статус и пушим обратно
    let { data: currentRoom } = await supabase.from('geo_rooms').select('players').eq('room_code', roomCode).single();
    
    let updatedPlayers = currentRoom.players.map(p => {
        if (p.name === myName) {
            p.clickX = clickX;
            p.clickY = clickY;
            p.done = true;
        }
        return p;
    });

    await supabase.from('geo_rooms').update({ players: updatedPlayers }).eq('room_code', roomCode);
}

// ВЫЧИСЛЕНИЕ И ПОКАЗ РЕЗУЛЬТАТОВ РАУНДА
function displayRoundResults(players) {
    const target = geoLocations[currentLocIndex];
    let scoreboard = `Правильный ответ: ${target.name}!\n\nИтоги раунда:\n`;

    players.forEach(p => {
        if (p.clickX !== null) {
            // Считаем погрешность по Пифагору на сетке процентов
            const distance = Math.hypot(p.clickX - target.pctX, p.clickY - target.pctY);
            // Формула начисления очков (макс 5000 за идеальный клик)
            const roundPoints = Math.max(0, Math.round(5000 - distance * 125));
            scoreboard += `${p.name}: +${roundPoints} очков (Погрешность: ${Math.round(distance)}%)\n`;
        } else {
            scoreboard += `${p.name}: Не успел сделать выбор (0 очков)\n`;
        }
    });

    alert(scoreboard);
}

// ЛОГИКА УПРАВЛЕНИЯ РАУНДАМИ ДЛЯ ХОСТА
async function triggerNextRound() {
    let { data: room } = await supabase.from('geo_rooms').select('*').eq('room_code', roomCode).single();
    if (!room) return;

    if (room.game_state === 'guessing') {
        // Считаем финальные очки перед переключением состояния
        const target = geoLocations[currentLocIndex];
        let updatedPlayers = room.players.map(p => {
            if (p.clickX !== null) {
                const distance = Math.hypot(p.clickX - target.pctX, p.clickY - target.pctY);
                const roundPoints = Math.max(0, Math.round(5000 - distance * 125));
                p.score += roundPoints; // Добавляем очки в общую копилку игрока
            }
            return p;
        });

        // Переводим игру в фазу результатов
        await supabase.from('geo_rooms').update({ 
            game_state: 'results',
            players: updatedPlayers 
        }).eq('room_code', roomCode);

    } else {
        // Переключаем на новый раунд: сбрасываем маркеры и генерируем новую локацию
        const nextLocIndex = Math.floor(Math.random() * geoLocations.length);
        let resetPlayers = room.players.map(p => {
            p.clickX = null;
            p.clickY = null;
            p.done = false;
            return p;
        });

        await supabase.from('geo_rooms').update({ 
            game_state: 'guessing', 
            current_location: nextLocIndex,
            players: resetPlayers 
        }).eq('room_code', roomCode);
    }
}
