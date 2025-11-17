// ====== CONFIG ======
const TOKEN = '1POdFZRZbvbqillRxMr2z';
const API = 'http://127.0.0.1:8000/callback';

// Utilidad para llamar a Spotify
async function sp(path, opts={}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ====== UI refs ======
const artEl   = document.getElementById('art');
const titleEl = document.getElementById('title');
const artistEl= document.getElementById('artist');
const btnPrev = document.getElementById('btnPrev');
const btnPlay = document.getElementById('btnPlay');
const btnNext = document.getElementById('btnNext');
const btnOpen = document.getElementById('btnOpen');
const closeBtn= document.getElementById('closeBtn');

let isPlaying = false;
let trackUrl  = 'https://open.spotify.com/';

// ====== Control handlers ======
btnPrev.onclick = () => sp('/me/player/previous', { method:'POST' }).catch(console.error);
btnNext.onclick = () => sp('/me/player/next',     { method:'POST' }).catch(console.error);
btnPlay.onclick = async () => {
  try{
    if (isPlaying) await sp('/me/player/pause', { method:'PUT' });
    else           await sp('/me/player/play',  { method:'PUT' });
    // refrescamos estado tras el toggle
    await refresh();
  }catch(e){ console.error(e); }
};
btnOpen.onclick = () => window.open(trackUrl, '_blank');
closeBtn.onclick = () => document.querySelector('.mini').style.display = 'none';

// ====== Estado de reproducción / carátula ======
async function getNowPlaying(){
  try{
    const data = await sp('/me/player/currently-playing'); // 200 o 204
    if (!data || !data.item) return null;

    const item = data.item;
    isPlaying  = !!data.is_playing;

    const cover = item.album?.images?.[1]?.url || item.album?.images?.[0]?.url;
    const title = item.name || 'Reproduciendo';
    const artist= (item.artists || []).map(a=>a.name).join(', ');
    trackUrl    = item.external_urls?.spotify || trackUrl;

    return { cover, title, artist, isPlaying };
  }catch(e){
    console.error('now playing:', e);
    return null;
  }
}

function render(state){
  if (!state) return;
  titleEl.textContent  = state.title;
  artistEl.textContent = state.artist;
  if (state.cover) artEl.src = state.cover;

  // carátula girando si está reproduciendo
  artEl.classList.toggle('spin', state.isPlaying);

  // alternar icono play/pause cambiando clase
  btnPlay.classList.toggle('pause', state.isPlaying);
  btnPlay.classList.toggle('play', !state.isPlaying);
}

// Refresco periódico (ligero: cada 5s)
async function refresh(){
  const s = await getNowPlaying();
  render(s);
}
refresh();
setInterval(refresh, 5000);

