/* ---------- РЕГИСТРАЦИЯ / ВХОД + ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ (Supabase) ----------
   Включается, когда в js/config.js заполнены supabaseUrl и supabaseAnonKey
   (см. README). Без них приложение работает как раньше — данные локально. */

let sb = null;
let sbUser = null;
let cloudReady = false; // первый pull прошёл успешно — можно пушить, не рискуя затереть облако
let cloudPushTimer = null;
let lastPulledUserId = null;
let lastSyncAt = null;
let authMode = 'login';

function authConfigured(){
  const c = window.ARCHIVE_CONFIG || {};
  return !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase);
}

function initAuth(){
  renderAuthButton();
  if(!authConfigured()) return;
  sb = window.supabase.createClient(window.ARCHIVE_CONFIG.supabaseUrl, window.ARCHIVE_CONFIG.supabaseAnonKey);
  sb.auth.onAuthStateChange((event, session)=>{
    sbUser = session ? session.user : null;
    renderAuthButton();
    if(!sbUser){ lastPulledUserId = null; cloudReady = false; return; }
    // SIGNED_IN дублируется (например, при возврате на вкладку) — тянем архив один раз на пользователя
    if(sbUser.id !== lastPulledUserId && (event==='INITIAL_SESSION' || event==='SIGNED_IN')){
      lastPulledUserId = sbUser.id;
      pullCloudArchive();
    }
  });
}

function renderAuthButton(){
  const area = document.getElementById('authArea');
  if(!area) return;
  const label = sbUser ? '👤 '+escapeHtml((sbUser.email||'').split('@')[0].toUpperCase()) : 'ВОЙТИ';
  area.innerHTML = `<button class="nav-icon-btn" onclick="openAuthModal()">${label}</button>`;
}

function openAuthModal(){
  document.getElementById('authOverlay').classList.add('show');
  document.getElementById('authStatus').textContent = '';
  renderAuthModal();
}
function closeAuthModal(){ document.getElementById('authOverlay').classList.remove('show'); }

function renderAuthModal(){
  const setupEl = document.getElementById('authSetupHint');
  const formEl = document.getElementById('authForm');
  const accEl = document.getElementById('authAccount');
  if(!authConfigured()){
    document.getElementById('authTitle').textContent = 'Аккаунты не настроены';
    setupEl.style.display = 'block'; formEl.style.display = 'none'; accEl.style.display = 'none';
    return;
  }
  setupEl.style.display = 'none';
  if(sbUser){
    document.getElementById('authTitle').textContent = 'Аккаунт';
    formEl.style.display = 'none'; accEl.style.display = 'block';
    document.getElementById('authAccountInfo').innerHTML = `
      <div class="import-hint" style="margin-top:0;">Вошёл как <b>${escapeHtml(sbUser.email||'')}</b>.<br>
      Архив синхронизируется автоматически при каждом изменении${lastSyncAt ? ' · последняя синхронизация '+new Date(lastSyncAt).toLocaleTimeString('ru-RU') : ''}.
      Ключи API (Steam, TMDB и т.д.) остаются на устройстве и не синхронизируются.</div>`;
  } else {
    document.getElementById('authTitle').textContent = authMode==='login' ? 'Вход' : 'Регистрация';
    formEl.style.display = 'block'; accEl.style.display = 'none';
    document.querySelectorAll('#authModePills .pill').forEach(p=>p.classList.toggle('active', p.dataset.v===authMode));
    document.getElementById('authSubmitBtn').textContent = authMode==='login' ? 'Войти' : 'Создать аккаунт';
  }
}
function switchAuthMode(m){
  authMode = m;
  document.getElementById('authStatus').textContent = '';
  renderAuthModal();
}

async function submitAuth(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const statusEl = document.getElementById('authStatus');
  if(!email || !password){ statusEl.textContent = 'Заполни email и пароль'; return; }
  statusEl.textContent = authMode==='login' ? 'вхожу...' : 'создаю аккаунт...';
  try{
    if(authMode==='register'){
      const {data, error} = await sb.auth.signUp({email, password});
      if(error) throw error;
      if(data && data.session){ closeAuthModal(); showToast('Аккаунт создан'); }
      // Если в проекте включено подтверждение почты, сессии сразу не будет
      else statusEl.textContent = 'Готово — подтверди email по ссылке из письма, потом войди';
    } else {
      const {error} = await sb.auth.signInWithPassword({email, password});
      if(error) throw error;
      closeAuthModal(); showToast('Вошёл');
    }
  }catch(e){
    statusEl.textContent = authErrorText(e);
  }
}
function authErrorText(e){
  const m = ((e && e.message) || '').toLowerCase();
  if(m.includes('invalid login credentials')) return 'Неверный email или пароль';
  if(m.includes('already registered')) return 'Такой email уже зарегистрирован — переключись на «Вход»';
  if(m.includes('at least 6')) return 'Пароль должен быть не короче 6 символов';
  if(m.includes('rate limit')) return 'Слишком много попыток — подожди минуту';
  if(m.includes('failed to fetch')) return 'Нет соединения — проверь интернет и данные в js/config.js';
  return 'Не получилось: ' + ((e && e.message) || 'неизвестная ошибка');
}

async function signOutAuth(){
  await sb.auth.signOut();
  closeAuthModal();
  showToast('Вышел — данные остаются в этом браузере');
}

/* ---------- Синхронизация ---------- */
// Слияние двух архивов: по каждому id побеждает более свежая версия (updated).
// Удаления переносятся тумбстоунами (archive-deleted), чтобы запись, стёртая
// на одном устройстве, не «воскресала» из облака на другом.
function mergeArchives(localEntries, localDeleted, remoteEntries, remoteDeleted){
  const deleted = {...(remoteDeleted||{})};
  Object.entries(localDeleted||{}).forEach(([id,ts])=>{ deleted[id] = Math.max(ts||0, deleted[id]||0); });
  const byId = {};
  [...(remoteEntries||[]), ...(localEntries||[])].forEach(e=>{
    if(!e || !e.id) return;
    if(!byId[e.id] || (e.updated||0) > (byId[e.id].updated||0)) byId[e.id] = e;
  });
  const merged = Object.values(byId).filter(e=>!(deleted[e.id] && deleted[e.id] >= (e.updated||0)));
  return {merged, deleted};
}

async function pullCloudArchive(){
  if(!sb || !sbUser) return;
  await appReady; // локальные записи должны быть загружены до слияния
  try{
    const {data, error} = await sb.from('archives').select('payload').eq('user_id', sbUser.id).maybeSingle();
    if(error) throw error;
    const remote = (data && data.payload) || {};
    const res = mergeArchives(entries, deletedIds, remote.entries, remote.deleted);
    entries = res.merged;
    deletedIds = res.deleted;
    cloudReady = true;
    await persist(); // persist заодно запушит слитый архив обратно в облако
    render();
    lastSyncAt = Date.now();
    if(document.getElementById('authOverlay').classList.contains('show')) renderAuthModal();
    showToast('Архив синхронизирован');
  }catch(e){
    // cloudReady остаётся false — не пушим поверх облака, которое не смогли прочитать
    console.error('cloud pull failed', e);
    showToast('Не удалось получить архив из облака — попробуй «Синхронизировать» в окне аккаунта');
  }
}

function scheduleCloudPush(){
  if(!sb || !sbUser || !cloudReady) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(pushCloudArchive, 1500);
}
async function pushCloudArchive(){
  if(!sb || !sbUser || !cloudReady) return;
  try{
    const {error} = await sb.from('archives').upsert({
      user_id: sbUser.id,
      payload: {entries, deleted: deletedIds},
      updated_at: new Date().toISOString()
    });
    if(error) throw error;
    lastSyncAt = Date.now();
  }catch(e){ console.error('cloud push failed', e); }
}

document.getElementById('authOverlay').addEventListener('click', e=>{ if(e.target.id==='authOverlay') closeAuthModal(); });
document.getElementById('authPassword').addEventListener('keydown', e=>{ if(e.key==='Enter') submitAuth(); });
document.addEventListener('keydown', e=>{
  if(e.key==='Escape' && document.getElementById('authOverlay').classList.contains('show')) closeAuthModal();
});
initAuth();
