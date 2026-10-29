import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Activity, ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpDown, ArrowUpRight, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Download, FileSpreadsheet, HeartHandshake, History, House, Info, ListFilter, LoaderCircle, LockKeyhole, Menu, Pause, Play, Plus, RefreshCw, ScanLine, Search, Settings2, ShieldCheck, Sparkles, Trash2, UserCheck, UserMinus, UserPlus, Users, X, Zap } from 'lucide-react';
import { calculateMetrics, type Metric } from '../core/analytics';
import { download, toCSV, toXLSX } from '../core/export';
import type { ActionKind, AppState, BatchJob, Command, ConnectionIssue, ScanMode, ScanSummary, Settings, User } from '../core/types';
import { version } from '../../package.json';
import { demoState, emptyState } from './demo';
import { isExtension, send } from './client';

type View = 'summary' | Metric | 'history' | 'export' | 'settings';
type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
const number = (n: number) => n.toLocaleString('es-ES');
const date = (n: number) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(n);
const dateTime = (n: number) => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(n);
const elapsed = (n: number) => n < 60 ? `${Math.floor(n)} s` : `${Math.floor(n / 60)} min ${Math.floor(n % 60)} s`;
const labels: Record<Metric, { title: string; description: string; icon: Icon; tone?: string }> = {
  lost: { title: 'Seguidores perdidos', description: 'Cuentas que ya no aparecen entre tus seguidores', icon: UserMinus, tone: 'pink' },
  new: { title: 'Nuevos seguidores', description: 'Personas que se han unido a tu comunidad', icon: UserPlus },
  newFollowing: { title: 'Nuevos seguidos', description: 'Cuentas que has empezado a seguir', icon: UserPlus },
  notFollowingBack: { title: 'No sigues de vuelta', description: 'Te siguen, pero tú no sigues sus cuentas', icon: UserMinus },
  notFollowedBack: { title: 'No te siguen de vuelta', description: 'Cuentas que sigues y que no te siguen', icon: Users },
  mutual: { title: 'Seguidores mutuos', description: 'Os seguís mutuamente en Instagram', icon: HeartHandshake },
  followers: { title: 'Todos los seguidores', description: 'Las personas que forman tu comunidad', icon: Users },
  following: { title: 'Todos los seguidos', description: 'Todas las cuentas que sigues', icon: UserCheck },
};
const navigation: { id: View; title: string; icon: Icon; separator?: boolean }[] = [
  { id: 'summary', title: 'Resumen', icon: House },
  ...(['lost', 'new', 'newFollowing', 'notFollowingBack', 'notFollowedBack', 'mutual'] as Metric[]).map(id => ({ id, title: labels[id].title, icon: labels[id].icon })),
  { id: 'history', title: 'Historial', icon: History, separator: true },
  { id: 'export', title: 'Exportar datos', icon: Download },
  { id: 'settings', title: 'Configuración', icon: Settings2 },
];

function Avatar({ user, large = false, enabled = true }: { user: User; large?: boolean; enabled?: boolean }) {
  const [broken, setBroken] = useState(false);
  const hue = [...user.username].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 360;
  return <span className={`avatar ${large ? 'avatar-lg' : ''}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 34%), hsl(${hue + 38} 50% 19%))` }}>
    {user.avatar && !broken && enabled ? <img src={user.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : user.fullName.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase() || user.username[0].toUpperCase()}
  </span>;
}

function Empty({ icon: Symbol = Users, title, children, action }: { icon?: Icon; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Symbol size={30} strokeWidth={1.5} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); old?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Cerrar" onClick={close}><X size={20} /></button></div>{children}</div></div>;
}

export function App() {
  const [data, setData] = useState<AppState>(emptyState);
  const [demo, setDemo] = useState(new URLSearchParams(location.search).has('demo'));
  const [view, setView] = useState<View>('summary');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [scanModal, setScanModal] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('full');
  const [pendingAction, updatePendingAction] = useState<{ action: ActionKind; users: User[]; accountId?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'snapshot' | 'account'; id: string } | null>(null);
  const [accountMenu, setAccountMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [privacy, setPrivacy] = useState('all');
  const [sort, setSort] = useState('default');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [draftSettings, setDraftSettings] = useState<Settings>(data.settings);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    if (demo) return;
    const id = ++requestId.current;
    try {
      const next = isExtension ? await send<AppState>({ type: 'STATE' }) : emptyState();
      if (id === requestId.current) setData(next);
    } catch (error) { setToast({ message: error instanceof Error ? error.message : 'No se han podido cargar los datos.', error: true }); }
    finally { setLoading(false); }
  }, [demo]);
  useEffect(() => {
    if (demo) { ++requestId.current; setData(demoState()); setLoading(false); }
    else void refresh();
    if (!isExtension || demo) return;
    const listener = () => { void refresh(); };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [demo, refresh]);
  useEffect(() => { setDraftSettings(data.settings); }, [data.settings]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 11000 : 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { setPage(1); setSelected(new Set()); setExportMenu(false); }, [view, query, privacy, data.activeId]);
  useEffect(() => { updatePendingAction(null); setScanModal(false); }, [data.activeId]);

  const account = data.accounts.find(item => item.id === data.activeId);
  const metrics = useMemo(() => calculateMetrics(data.latest, data.previous, data.full, data.previousFull, data.overrides), [data.latest, data.previous, data.full, data.previousFull, data.overrides]);
  const metric: Metric = view in labels ? view as Metric : 'lost';
  const users = metrics[metric];
  const filtered = useMemo(() => {
    const term = query.toLocaleLowerCase('es').trim();
    const found = users.filter(user => (!term || `${user.username} ${user.fullName}`.toLocaleLowerCase('es').includes(term)) && (privacy === 'all' || (privacy === 'private' ? user.isPrivate : !user.isPrivate)));
    if (sort === 'username') found.sort((a, b) => a.username.localeCompare(b.username, 'es'));
    if (sort === 'name') found.sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
    if (sort === 'reverse') found.reverse();
    return found;
  }, [users, query, sort, privacy]);
  const pages = Math.max(1, Math.ceil(filtered.length / data.settings.pageLength));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * data.settings.pageLength, currentPage * data.settings.pageLength);
  const selection = filtered.filter(user => selected.has(user.id));
  const followingIds = useMemo(() => new Set(metrics.following.map(user => user.id)), [metrics.following]);
  const activeScan = data.scan && ['running', 'paused'].includes(data.scan.status) ? data.scan : null;
  const activeBatch = data.batch && ['running', 'paused'].includes(data.batch.status) ? data.batch : null;
  const processing = !!activeScan || !!activeBatch;
  const foreignJob = (activeScan ?? activeBatch)?.accountId !== data.activeId;
  const setPendingAction = (value: { action: ActionKind; users: User[] } | null) => updatePendingAction(value ? { ...value, accountId: data.activeId ?? undefined } : null);

  const run = async (command: Command, success?: string): Promise<boolean> => {
    if (demo) { setToast({ message: 'Modo demostración: no se envían solicitudes ni se modifican cuentas de Instagram.' }); return false; }
    setBusy(true);
    try { await send(command); await refresh(); if (success) setToast({ message: success }); return true; }
    catch (error) {
      if (command.type === 'START_SCAN') setScanModal(false);
      setToast({ message: error instanceof Error ? error.message : 'No se ha podido completar la operación.', error: true });
      await refresh();
      return false;
    }
    finally { setBusy(false); }
  };

  const exportUsers = (format: 'csv' | 'json' | 'xlsx', rows = selection.length ? selection : filtered, title = labels[metric].title) => {
    if (!rows.length) { setToast({ message: 'No hay cuentas para exportar.' }); return; }
    const slug = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll(' ', '-');
    const filename = `ig-tracker-${slug}-${new Date().toISOString().slice(0, 10)}.${format}`;
    if (format === 'csv') download(toCSV(rows), filename, 'text/csv;charset=utf-8');
    else if (format === 'xlsx') download(toXLSX(rows), filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else download(JSON.stringify({ version: 1, cuenta: account?.username, lista: title, exportadoEl: new Date().toISOString(), total: rows.length, cuentas: rows.map(user => ({ identificador: user.id, usuario: user.username, nombre: user.fullName, privada: user.isPrivate, verificada: user.isVerified })) }, null, 2), filename, 'application/json');
    setExportMenu(false); setToast({ message: `${number(rows.length)} cuentas exportadas correctamente.` });
  };
  const navigate = (next: View) => { setView(next); setQuery(''); setPrivacy('all'); setSort('default'); setMobileNav(false); };
  const beginScan = () => { if (!account) { void run({ type: 'CONNECT' }, 'Cuenta conectada. Ya puedes iniciar tu primer escaneo.'); } else setScanModal(true); };
  const toggleUser = (id: string) => setSelected(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const allVisible = visible.length > 0 && visible.every(user => selected.has(user.id));
  const toggleVisible = () => setSelected(old => { const next = new Set(old); visible.forEach(user => allVisible ? next.delete(user.id) : next.add(user.id)); return next; });

  const title = view === 'summary' ? 'Tu comunidad, de un vistazo' : view === 'history' ? 'Historial de escaneos' : view === 'export' ? 'Tus datos, sin límites' : view === 'settings' ? 'Configuración' : labels[metric].title;
  const description = view === 'summary' ? 'Conoce quién llega, quién se va y quién se queda.' : view === 'history' ? 'Cada cambio empieza con una buena referencia.' : view === 'export' ? 'Exporta listas completas. Siempre bajo tu control.' : view === 'settings' ? 'Ajusta IG Tracker a tu manera.' : labels[metric].description;
  const listView = view in labels;
  const cards: Metric[] = ['lost', 'new', 'newFollowing', 'notFollowedBack'];

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <div className="brand"><span className="brand-symbol"><Activity size={31} strokeWidth={2.2} /></span><div><strong>IG Tracker<span className="brand-dot">.</span></strong><span>Tu comunidad, más clara</span></div><button className="mobile-close icon-button" aria-label="Cerrar navegación" onClick={() => setMobileNav(false)}><X /></button></div>
      <div className="nav-caption">TU COMUNIDAD</div>
      <nav aria-label="Navegación principal">{navigation.map(({ id, title: name, icon: Symbol, separator }) => <div key={id} className={separator ? 'nav-section' : ''}><button className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined}><Symbol size={21} strokeWidth={1.7} /><span>{name}</span>{id === 'lost' && metrics.lost.length > 0 && <small>{metrics.lost.length}</small>}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="local-note"><ShieldCheck size={16} /><span>Privado. Local. Sin suscripción.</span></div>
        {accountMenu && <div className="account-popover"><p>TUS CUENTAS</p>{data.accounts.map(item => <button key={item.id} onClick={() => { void run({ type: 'SELECT_ACCOUNT', accountId: item.id }); setAccountMenu(false); }}><Avatar user={item} /><span>@{item.username}</span>{item.id === data.activeId && <Check size={16} />}</button>)}<button onClick={() => { setAccountMenu(false); void run({ type: 'CONNECT' }, 'Cuenta conectada correctamente.'); }}><Plus size={18} />Conectar otra cuenta</button></div>}
        <button className="account-card" onClick={() => account ? setAccountMenu(!accountMenu) : void run({ type: 'CONNECT' })} disabled={busy}>{account ? <Avatar user={account} /> : <span className="avatar"><Users size={20} /></span>}<span><strong>{account ? `@${account.username}` : 'Tu cuenta de Instagram'}</strong><small><i className={account ? 'status-dot' : 'status-dot off'} />{demo ? 'Cuenta de demostración' : account ? 'Historial local conectado' : 'Conecta para empezar'}</small></span><ChevronDown size={16} /></button>
      </div>
    </aside>
    {mobileNav && <button className="nav-overlay" aria-label="Cerrar menú" onClick={() => setMobileNav(false)} />}
    <main className="main-panel">
      <div className="topline"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Abrir navegación" onClick={() => setMobileNav(true)}><Menu size={20} /></button><span>Mi espacio</span><ChevronRight size={13} /><strong>{view === 'summary' ? 'Resumen' : title}</strong></div><div className="topline-right"><span className="local-pill"><span className="status-dot" />{demo ? 'Datos de ejemplo' : 'Solo en tu dispositivo'}</span><button className="icon-button help-button" aria-label="Ayuda e información" onClick={() => navigate('settings')}><CircleHelp size={18} /></button></div></div>
      {demo && <div className="demo-banner"><Sparkles size={16} /><span><strong>Modo demostración.</strong> Estás viendo datos de ejemplo; ninguna acción afecta a Instagram.</span><button onClick={() => { setDemo(false); setView('summary'); }}>Salir de la demo <X size={14} /></button></div>}
      {!isExtension && !demo && <div className="demo-banner"><Info size={16} /><span>Vista previa web. Para conectar Instagram, carga la carpeta <strong>dist</strong> como extensión.</span><button onClick={() => setDemo(true)}>Explorar demo <ArrowRight size={14} /></button></div>}
      <header className="page-header"><div><div className="eyebrow"><span /> ANALÍTICA DE INSTAGRAM</div><h1>{title}</h1><p>{description}</p></div><div className="header-actions">{(listView || view === 'summary') && <div className="dropdown-wrap"><button className="button secondary" onClick={() => listView ? setExportMenu(!exportMenu) : navigate('export')} disabled={loading}><Download size={17} />Exportar{listView && <ChevronDown size={13} />}</button>{exportMenu && <div className="dropdown export-dropdown"><span>{selection.length ? `${selection.length} seleccionadas` : `${filtered.length} cuentas de la lista`}</span>{(['csv', 'xlsx', 'json'] as const).map(format => <button key={format} onClick={() => exportUsers(format)}><FileSpreadsheet size={17} />Descargar {format.toUpperCase()}</button>)}</div>}</div>}<button className="button primary" onClick={beginScan} disabled={busy || !!processing}><ScanLine size={18} />{busy ? 'Conectando…' : account ? 'Nuevo escaneo' : 'Conectar Instagram'}</button></div></header>

      {!demo && data.connectionIssue && <ConnectionProblem issue={data.connectionIssue} now={now} disabled={busy} retry={() => {
        if (activeScan?.status === 'paused') void run({ type: 'SCAN_CONTROL', action: 'resume' });
        else if (activeBatch?.status === 'paused') void run({ type: 'BATCH_CONTROL', action: 'resume' });
        else if (account) setScanModal(true);
        else void run({ type: 'CONNECT' }, 'Cuenta conectada. Ya puedes iniciar tu primer escaneo.');
      }} />}
      {activeScan && <ScanProgress scan={activeScan} now={now} accountName={data.accounts.find(item => item.id === activeScan.accountId)?.username} disabled={busy} control={action => void run({ type: 'SCAN_CONTROL', action })} />}
      {data.batch && <BatchProgress job={data.batch} disabled={busy} control={action => void run({ type: 'BATCH_CONTROL', action })} />}
      {foreignJob && processing && <div className="notice"><Info size={17} />El proceso activo pertenece a otra de tus cuentas. Los datos de esta pantalla no se mezclarán.</div>}

      {loading ? <div className="loading-screen"><LoaderCircle className="spin" size={26} /><p>Cargando tu espacio…</p></div> : <>
        {(view === 'summary' || listView) && <>
          <div className="period-row"><div className="section-label"><span className="live-dot" />{data.latest ? 'ÚLTIMO ESCANEO' : 'TU PRÓXIMA PERSPECTIVA'}<span className="period-date">{data.latest ? dateTime(data.latest.completedAt) : 'Todo empieza con tu primer escaneo'}</span></div><span className="period-compare"><Clock3 size={13} />{data.previous ? 'Comparado con el escaneo anterior' : 'Sin referencia anterior todavía'}</span></div>
          <section className="stats-grid" aria-label="Estadísticas principales">{cards.map(id => {
            const card = labels[id], Symbol = card.icon;
            const ready = id === 'newFollowing' ? !!data.previousFull : id === 'notFollowedBack' ? !!data.full : !!data.previous;
            return <button key={id} className={`stat-card ${card.tone ?? ''} ${view === id ? 'chosen' : ''}`} onClick={() => navigate(id)}>
              <div className="stat-top"><span className="stat-icon"><Symbol size={23} strokeWidth={1.7} /></span><ArrowUpRight size={16} className="stat-link" /></div>
              <div className="stat-value">{ready ? number(metrics[id].length) : '—'}<span className="stat-decoration" aria-hidden="true"><Symbol size={34} strokeWidth={1.3} /></span></div>
              <h2>{card.title}</h2>
              <div className="stat-foot">{ready ? <><span className={id === 'lost' ? 'trend negative' : 'trend'}>{id === 'lost' ? <ArrowDownRightIcon /> : <Check size={13} />}{id === 'notFollowedBack' ? 'Relación actual' : 'Cambio detectado'}</span><span>{id === 'notFollowedBack' ? 'en tus listas' : 'entre escaneos'}</span></> : <span>{id === 'notFollowedBack' ? 'Requiere escaneo completo' : 'Requiere dos escaneos'}</span>}</div>
            </button>;
          })}</section>
        </>}

        {view === 'summary' && <>
          {!data.latest ? <section className="welcome-card"><div className="welcome-visual"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit orbit-three" /><span className="welcome-icon"><Users size={39} strokeWidth={1.5} /></span><span className="floating-badge"><ShieldCheck size={14} /> 100 % local</span></div><div className="welcome-text"><span className="eyebrow">MENOS SUPOSICIONES. MÁS CLARIDAD.</span><h2>Tu comunidad tiene una historia.<br />Empieza a conocerla.</h2><p>Conecta tu cuenta y crea tu primera referencia. Después de tu segundo escaneo verás quién llega y quién deja de seguirte.</p><div className="welcome-actions"><button className="button primary" onClick={beginScan} disabled={busy || !!processing}><ScanLine size={17} />{account ? 'Iniciar primer escaneo' : 'Conectar mi Instagram'}</button><button className="text-button" onClick={() => setDemo(true)}>Ver demostración <ArrowUpRight size={15} /></button></div><div className="trust-row"><span><Check size={13} />Sin contraseña adicional</span><span><Check size={13} />Sin límites Pro</span></div></div></section> : <div className="summary-grid"><section className="panel community-panel"><div className="panel-heading"><div><span className="eyebrow">TU COMUNIDAD</span><h2>Conexiones que cuentan</h2></div><Users size={21} className="muted" /></div><div className="community-body"><div className="donut"><div><strong>{number(metrics.followers.length)}</strong><span>seguidores</span></div></div><div className="community-legend">{(['followers', 'following', 'mutual'] as Metric[]).map((id, i) => <button key={id} onClick={() => navigate(id)}><span className={`legend-dot legend-${i}`} /><span>{id === 'followers' ? 'Seguidores' : id === 'following' ? 'Seguidos' : 'Conexiones mutuas'}</span><strong>{id !== 'followers' && !data.full ? '—' : number(metrics[id].length)}</strong><ChevronRight size={14} /></button>)}</div></div><div className="panel-bottom-note"><ShieldCheck size={14} />Tus datos no salen de este navegador.</div></section><section className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">MOVIMIENTO RECIENTE</span><h2>Así ha cambiado tu comunidad</h2></div><Activity size={21} className="muted" /></div>{!data.previous ? <Empty icon={Clock3} title="La primera referencia está lista">Vuelve a escanear más adelante para descubrir los cambios.</Empty> : <div className="activity-items">{(['new', 'lost', 'newFollowing'] as Metric[]).map(id => { const Symbol = labels[id].icon; return <button key={id} onClick={() => navigate(id)}><span className={`activity-symbol ${id === 'lost' ? 'pink' : ''}`}><Symbol size={20} /></span><div><strong>{labels[id].title}</strong><small>Desde el escaneo anterior</small></div><b className={id === 'lost' ? 'pink-text' : ''}>{id === 'lost' ? '−' : '+'}{metrics[id].length}</b><ChevronRight size={16} /></button>; })}</div>}</section></div>}
          <div className="insights-heading"><h2>Explora tus conexiones</h2><span>Más información, mejores decisiones.</span></div><div className="insights-grid">{(['notFollowedBack', 'notFollowingBack', 'mutual'] as Metric[]).map(id => { const Symbol = labels[id].icon; return <button className="insight-card" key={id} onClick={() => navigate(id)}><Symbol size={23} strokeWidth={1.6} /><div><h3>{labels[id].title}</h3><p>{labels[id].description}</p></div><ChevronRight size={18} /></button>; })}</div>
        </>}

        {listView && <section className="panel table-panel">
          <div className="table-heading"><div><h2>{labels[metric].title} <span className="count-badge">{number(users.length)}</span></h2><p>{metric === 'lost' ? 'Pérdidas detectadas entre los dos últimos escaneos completos de seguidores' : 'Todas tus cuentas, sin recortes ni límites de resultados'}</p></div><div className="table-tools"><label className="search-field"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar usuario o nombre…" aria-label="Buscar usuario o nombre" />{query && <button aria-label="Limpiar búsqueda" onClick={() => setQuery('')}><X size={14} /></button>}</label><label className="sort-select"><ArrowUpDown size={15} /><select aria-label="Ordenar cuentas" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="default">Orden del escaneo</option><option value="reverse">Orden inverso</option><option value="username">Usuario: A–Z</option><option value="name">Nombre: A–Z</option></select><ChevronDown size={13} /></label></div></div>
          <div className="table-filterbar"><div className="filter-tabs">{[{ id: 'all', title: 'Todas' }, { id: 'public', title: 'Públicas' }, { id: 'private', title: 'Privadas' }].map(item => <button key={item.id} className={privacy === item.id ? 'active' : ''} onClick={() => setPrivacy(item.id)}>{item.title}{item.id === 'all' && <span>{users.length}</span>}</button>)}</div><span className="table-caption"><ListFilter size={14} />{number(filtered.length)} cuentas</span></div>
          {selection.length > 0 && <div className="selection-bar"><span><CheckCheck size={16} />{number(selection.length)} seleccionadas</span><button onClick={() => setSelected(new Set(filtered.map(user => user.id)))}>Seleccionar las {number(filtered.length)}</button><div className="selection-actions"><button disabled={!!processing} onClick={() => setPendingAction({ action: 'follow', users: selection })}>Seguir</button><button disabled={!!processing} onClick={() => setPendingAction({ action: 'unfollow', users: selection })}>Dejar de seguir</button><button disabled={!!processing} onClick={() => setPendingAction({ action: 'removeFollower', users: selection })}>Eliminar seguidores</button><button aria-label="Limpiar selección" onClick={() => setSelected(new Set())}><X size={15} /></button></div></div>}
          {!data.latest ? <Empty title="Todavía no hay datos" icon={ScanLine} action={<button className="button secondary" onClick={beginScan}>Empezar mi primer escaneo</button>}>Conecta Instagram y realiza un escaneo para descubrir tus conexiones.</Empty> : (metric === 'lost' || metric === 'new') && !data.previous ? <Empty title="Tu primer escaneo es la referencia" icon={History}>Necesitas un segundo escaneo para identificar cambios. No es posible recuperar quién te dejó de seguir antes de empezar.</Empty> : ['notFollowingBack', 'notFollowedBack', 'mutual', 'following'].includes(metric) && !data.full ? <Empty title="Falta escanear tus seguidos" icon={Users} action={<button className="button secondary" disabled={!!processing} onClick={() => { setScanMode('full'); setScanModal(true); }}>Hacer un escaneo completo</button>}>Elige «Escaneo completo» para comparar seguidores y seguidos.</Empty> : metric === 'newFollowing' && !data.previousFull ? <Empty title="Necesitas dos escaneos completos" icon={History}>Los nuevos seguidos se identifican comparando dos listas completas de seguidos.</Empty> : !filtered.length ? <Empty title={query || privacy !== 'all' ? 'No encontramos coincidencias' : 'Todo al día por aquí'} icon={query ? Search : CheckCircle2}>{query || privacy !== 'all' ? 'Prueba con otro nombre o cambia el filtro.' : metric === 'lost' ? 'No se han detectado pérdidas de seguidores entre estas dos capturas.' : 'No hay cuentas en esta categoría.'}</Empty> : <div className="table-scroll"><table><thead><tr><th className="checkbox-cell"><input type="checkbox" checked={allVisible} onChange={toggleVisible} aria-label="Seleccionar página actual" /></th><th>Usuario</th><th>Nombre</th><th>{metric === 'lost' ? 'Pérdida detectada' : 'Relación contigo'}</th><th className="actions-column">Acciones</th></tr></thead><tbody>{visible.map(user => {
            const override = data.overrides.find(item => item.userId === user.id && item.accountId === data.activeId && (item.followingAt ?? item.updatedAt) > (data.full?.startedAt ?? 0));
            const isFollowing = override?.following ?? (data.full ? followingIds.has(user.id) : user.following);
            const requestPending = override?.requested;
            return <tr key={user.id} className={selected.has(user.id) ? 'selected' : ''}><td className="checkbox-cell"><input type="checkbox" checked={selected.has(user.id)} onChange={() => toggleUser(user.id)} aria-label={`Seleccionar a ${user.username}`} /></td><td><a className="user-cell" href={`https://www.instagram.com/${encodeURIComponent(user.username)}/`} target="_blank" rel="noreferrer"><Avatar user={user} enabled={data.settings.showAvatars} /><span><strong>@{user.username}{user.isVerified && <CheckCircle2 size={13} className="verified" />}</strong><small>Ver perfil <ArrowUpRight size={11} /></small></span></a></td><td><div className="name-cell"><span>{user.fullName || 'Sin nombre'}</span>{user.isPrivate ? <small className="user-tag"><LockKeyhole size={10} />Privada</small> : user.isVerified ? <small className="user-tag">Verificada</small> : <small className="plain-tag">Cuenta pública</small>}</div></td><td>{metric === 'lost' ? <div className="detected-cell"><Clock3 size={16} /><span>{date(data.latest!.completedAt)}<small>Entre dos escaneos</small></span></div> : <span className={`relation-tag ${requestPending ? 'requested' : isFollowing ? 'following' : ''}`}>{requestPending ? 'Solicitud enviada' : isFollowing === undefined ? 'Sin comprobar' : isFollowing ? 'Siguiendo' : 'No sigues'}</span>}</td><td><div className="row-actions"><button className={`button small ${isFollowing ? 'secondary' : 'primary'}`} disabled={!!processing || busy || requestPending} onClick={() => setPendingAction({ action: isFollowing ? 'unfollow' : 'follow', users: [user] })}>{requestPending ? 'Solicitado' : isFollowing ? 'Dejar de seguir' : 'Seguir'}</button><button className="icon-button delete-follower" title="Eliminar de tus seguidores" aria-label={`Eliminar a ${user.username} de tus seguidores`} disabled={!!processing || busy} onClick={() => setPendingAction({ action: 'removeFollower', users: [user] })}><UserMinus size={17} /></button></div></td></tr>;
          })}</tbody></table></div>}
          <div className="table-footer"><span>{filtered.length ? `Mostrando ${number((currentPage - 1) * data.settings.pageLength + 1)}–${number(Math.min(currentPage * data.settings.pageLength, filtered.length))} de ${number(filtered.length)} cuentas` : 'Sin cuentas para mostrar'}{selection.length > 0 && <small> · {selection.length} seleccionadas</small>}</span><div className="pagination"><button aria-label="Página anterior" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button>{[...new Set([1, ...Array.from({ length: 3 }, (_, i) => currentPage - 1 + i).filter(n => n > 1 && n < pages), pages])].sort((a, b) => a - b).map((n, i, arr) => <span key={n}>{i > 0 && n - arr[i - 1] > 1 && <span className="page-ellipsis">…</span>}<button className={currentPage === n ? 'active' : ''} onClick={() => setPage(n)} aria-label={`Página ${n}`} aria-current={currentPage === n ? 'page' : undefined}>{n}</button></span>)}<button aria-label="Página siguiente" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div></div>
          {metric === 'lost' && data.latest && <div className="table-disclaimer"><Info size={13} />La fecha indica cuándo se detectó la ausencia, no la hora exacta del unfollow. Una cuenta eliminada o desactivada también puede dejar de aparecer.</div>}
          {data.full && data.latest && data.full.id !== data.latest.id && !['lost', 'new', 'followers'].includes(metric) && <div className="table-disclaimer"><Clock3 size={13} />Los seguidos corresponden al último escaneo completo: {dateTime(data.full.completedAt)}.</div>}
        </section>}

        {view === 'history' && <section className="panel"><div className="panel-heading"><div><h2>Un registro de tu comunidad <span className="count-badge">{data.history.length}</span></h2><p>Solo se guardan escaneos finalizados y validados.</p></div><History className="muted" size={22} /></div>{!data.history.length ? <Empty icon={History} title="Tu historia empieza aquí">Al completar tu primer escaneo aparecerá una captura en este historial.</Empty> : <div className="table-scroll"><table className="history-table"><thead><tr><th>Fecha</th><th>Tipo de escaneo</th><th>Seguidores</th><th>Seguidos</th><th>Duración</th><th>Acciones</th></tr></thead><tbody>{data.history.map((item, index) => <tr key={item.id}><td><div className="history-date"><span className="history-icon"><CheckCircle2 size={18} /></span><div><strong>{dateTime(item.completedAt)}</strong><small>{index === 0 ? 'Captura más reciente' : 'Captura guardada'}</small></div></div></td><td><span className="relation-tag">{item.mode === 'full' ? 'Completo' : 'Solo seguidores'}</span></td><td>{number(item.followers)}</td><td>{item.following === null ? '—' : number(item.following)}</td><td>{elapsed((item.completedAt - item.startedAt) / 1000)}</td><td><button className="icon-button" aria-label={`Eliminar escaneo del ${dateTime(item.completedAt)}`} onClick={() => setConfirmDelete({ kind: 'snapshot', id: item.id })}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>}<div className="panel-bottom-note"><Info size={14} />Eliminar una captura recalcula las comparaciones usando las capturas restantes. El historial no tiene una cuota comercial.</div></section>}

        {view === 'export' && <><div className="export-hero panel"><span className="export-hero-icon"><ArrowDownToLine size={34} strokeWidth={1.5} /></span><div><h2>Tu comunidad no cabe en 50 filas.</h2><p>Descarga todas tus cuentas, en el formato que prefieras. Sin recortes, pagos ni suscripciones.</p></div><span className="feature-tag"><CheckCircle2 size={14} />Exportación completa</span></div><div className="export-grid">{(['followers', 'following', 'lost', 'new', 'notFollowedBack', 'notFollowingBack', 'mutual', 'newFollowing'] as Metric[]).map(id => { const Symbol = labels[id].icon; return <section className="panel export-card" key={id}><div className="export-card-top"><Symbol size={24} /><span>{number(metrics[id].length)} cuentas</span></div><h3>{labels[id].title}</h3><p>{labels[id].description}</p><div className="format-buttons">{(['csv', 'xlsx', 'json'] as const).map(format => <button key={format} disabled={!metrics[id].length} onClick={() => exportUsers(format, metrics[id], labels[id].title)}><Download size={13} />{format.toUpperCase()}</button>)}</div></section>; })}</div><div className="notice"><ShieldCheck size={18} />Los archivos se generan en tu navegador. No se suben a ningún servidor. CSV y Excel protegen los nombres que podrían interpretarse como fórmulas.</div></>}

        {view === 'settings' && <div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><h2><Zap size={20} />Motor de escaneo</h2><p>Menos esperas artificiales. Más control real.</p></div></div><div className="settings-body"><label className="setting-field"><span>Cuentas por petición<small>Instagram puede entregar menos cuentas o requerir páginas de 50.</small></span><select value={draftSettings.pageSize} onChange={event => setDraftSettings({ ...draftSettings, pageSize: Number(event.target.value) })}><option value={50}>50 · Conservador</option><option value={100}>100 · Equilibrado</option><option value={200}>200 · Ampliado</option></select></label><label className="setting-field"><span>Pausa entre páginas<small>No hay una velocidad garantizada: se adapta ante errores o límites.</small></span><select value={draftSettings.intervalMs} onChange={event => setDraftSettings({ ...draftSettings, intervalMs: Number(event.target.value) })}><option value={0}>Sin pausa adicional</option><option value={250}>250 ms · Ágil</option><option value={1000}>1 segundo</option><option value={3000}>3 segundos</option></select></label><label className="setting-field"><span>Pausa entre acciones<small>Los lotes se ejecutan secuencialmente y se detienen ante un error.</small></span><select value={draftSettings.actionIntervalMs} onChange={event => setDraftSettings({ ...draftSettings, actionIntervalMs: Number(event.target.value) })}><option value={1000}>1 segundo</option><option value={1500}>1,5 segundos</option><option value={3000}>3 segundos</option><option value={5000}>5 segundos</option><option value={10000}>10 segundos</option></select></label><label className="setting-field"><span>Filas por página<small>La paginación no limita los resultados ni las exportaciones.</small></span><select value={draftSettings.pageLength} onChange={event => setDraftSettings({ ...draftSettings, pageLength: Number(event.target.value) })}>{[25, 50, 100].map(n => <option key={n} value={n}>{n} cuentas</option>)}</select></label><label className="setting-field"><span>Mostrar fotografías<small>Las imágenes de perfil se cargan bajo demanda desde Instagram.</small></span><input className="switch" type="checkbox" checked={draftSettings.showAvatars} onChange={event => setDraftSettings({ ...draftSettings, showAvatars: event.target.checked })} /></label><div className="settings-save"><button className="button primary" disabled={busy} onClick={() => void run({ type: 'SETTINGS', settings: draftSettings }, 'Configuración guardada.') }><Check size={16} />Guardar configuración</button></div></div></section><div className="settings-side"><section className="panel privacy-panel"><ShieldCheck size={28} /><h2>Privacidad por diseño</h2><p>Sin servidores propios, telemetría, publicidad ni cuentas adicionales. Las credenciales de Instagram permanecen en su pestaña.</p><ul><li><Check size={14} />Datos e historial en este navegador</li><li><Check size={14} />Permisos solo para Instagram</li><li><Check size={14} />Sin funciones bloqueadas por pago</li></ul><button className="text-button" onClick={() => setDemo(!demo)}><Sparkles size={15} />{demo ? 'Salir de la demostración' : 'Explorar con datos de ejemplo'}</button></section><section className="panel caution-panel"><Info size={23} /><h3>Antes de empezar</h3><p>Instagram no ofrece un contrato público estable para estas listas. Puede cambiar sus interfaces, restringir las consultas o pedir una verificación. Un escaneo incompleto nunca sustituye una captura válida.</p><p>Usa la herramienta en tus propias cuentas y respeta las condiciones de Instagram. «Seguidores perdidos» indica ausencias, no prueba por sí solo un unfollow voluntario.</p></section>{account && <section className="panel danger-panel"><h3>Datos de esta cuenta</h3><p>Borra el historial y la conexión local de @{account.username}. No elimina nada de Instagram.</p><button className="button danger" disabled={!!processing} onClick={() => setConfirmDelete({ kind: 'account', id: account.id })}><Trash2 size={15} />Eliminar datos locales</button></section>}</div></div>}
      </>}
      <footer className="app-footer"><span><ShieldCheck size={13} />Hecho para tu privacidad, no para una suscripción.</span><span>IG Tracker <span className="version">v{version}</span></span></footer>
    </main>

    {scanModal && <Modal title="Un nuevo vistazo a tu comunidad" close={() => setScanModal(false)}><p className="modal-description">Escanearemos la sesión de <strong>@{account?.username}</strong>. Mantén una pestaña de Instagram abierta; puedes seguir usando este panel.</p><div className="scan-options">{[{ mode: 'full' as const, icon: Users, title: 'Escaneo completo', text: 'Seguidores + seguidos. Todas las estadísticas y relaciones.', tag: 'RECOMENDADO' }, { mode: 'followers' as const, icon: Zap, title: 'Solo seguidores', text: 'Menos consultas para detectar nuevas incorporaciones y pérdidas.', tag: 'MÁS LIGERO' }].map(({ mode, icon: Symbol, title: optionTitle, text, tag }) => <button className={`scan-option ${scanMode === mode ? 'active' : ''}`} key={mode} onClick={() => setScanMode(mode)}><Symbol size={23} /><span><strong>{optionTitle}<small>{tag}</small></strong><p>{text}</p></span><span className="radio-indicator">{scanMode === mode && <span />}</span></button>)}</div><div className="notice compact"><ShieldCheck size={16} />Solo guardaremos la captura cuando todas las páginas estén completas y sus recuentos coincidan.</div><div className="modal-buttons"><button className="button secondary" onClick={() => setScanModal(false)}>Ahora no</button><button className="button primary" disabled={busy} onClick={async () => { if (await run({ type: 'START_SCAN', mode: scanMode })) setScanModal(false); }}><ScanLine size={17} />{busy ? 'Preparando…' : 'Iniciar escaneo'}</button></div></Modal>}
    {pendingAction && <Modal title={pendingAction.action === 'follow' ? 'Seguir cuentas' : pendingAction.action === 'unfollow' ? 'Dejar de seguir cuentas' : 'Eliminar seguidores'} close={() => setPendingAction(null)}><p className="modal-description">Esta acción modificará las relaciones de <strong>@{account?.username}</strong> en Instagram.</p><div className="action-preview"><Users size={24} /><div><strong>{number(pendingAction.users.length)} {pendingAction.users.length === 1 ? 'cuenta seleccionada' : 'cuentas seleccionadas'}</strong><p>{pendingAction.users.slice(0, 3).map(user => `@${user.username}`).join(', ')}{pendingAction.users.length > 3 ? ` y ${pendingAction.users.length - 3} más` : ''}</p></div></div><div className="notice warning"><Info size={17} />{pendingAction.action === 'removeFollower' ? 'Estas cuentas dejarán de seguirte. No se bloquean. Revisa la selección: esta acción no se puede deshacer automáticamente.' : pendingAction.action === 'unfollow' ? 'Dejarás de seguir estas cuentas. Si son privadas, volver a seguirlas puede requerir su aprobación.' : 'En las cuentas privadas se enviará una solicitud. Instagram puede aplicar límites a estas acciones.'}</div><p className="modal-fineprint">El lote se ejecuta cuenta por cuenta. Ante un resultado incierto no repetimos la acción automáticamente. Ningún lote de demostración afecta a cuentas reales.</p><div className="modal-buttons"><button className="button secondary" onClick={() => setPendingAction(null)}>Cancelar</button><button className="button primary" disabled={busy || !!processing} onClick={async () => { if (await run({ type: 'START_BATCH', ...pendingAction })) { setPendingAction(null); setSelected(new Set()); } }}><Check size={16} />{busy ? 'Preparando…' : 'Confirmar acción'}</button></div></Modal>}
    {confirmDelete && <Modal title="¿Eliminar estos datos locales?" close={() => setConfirmDelete(null)}><p className="modal-description">{confirmDelete.kind === 'account' ? 'Se eliminarán la conexión local, todas las capturas y los resultados de esta cuenta.' : 'Se eliminará esta captura. Las comparaciones se recalcularán con las capturas restantes.'} Esta acción no modifica Instagram y no se puede deshacer.</p><div className="modal-buttons"><button className="button secondary" onClick={() => setConfirmDelete(null)}>Conservar</button><button className="button danger" disabled={busy} onClick={async () => { if (await run(confirmDelete.kind === 'account' ? { type: 'CLEAR_ACCOUNT', accountId: confirmDelete.id } : { type: 'DELETE_SNAPSHOT', id: confirmDelete.id }, 'Datos locales eliminados.')) setConfirmDelete(null); }}><Trash2 size={16} />Eliminar definitivamente</button></div></Modal>}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`toast ${toast.error ? 'error' : ''}`}>{toast.error ? <Info size={20} /> : <CheckCircle2 size={20} />}<span>{toast.message}</span><button aria-label="Cerrar aviso" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>;
}

function ArrowDownRightIcon() { return <ArrowDownLeft size={13} />; }

function ConnectionProblem({ issue, now, disabled, retry }: { issue: ConnectionIssue; now: number; disabled: boolean; retry: () => void }) {
  const remaining = Math.max(0, Math.ceil(((issue.retryAt ?? 0) - now) / 1000));
  return <section className="connection-problem panel" aria-label="Problema de conexión con Instagram">
    <div className="connection-problem-heading"><Info size={22} /><div><h2>No se pudo comprobar tu sesión</h2><p>{issue.message}</p></div></div>
    <p className="connection-guidance">{issue.code === 'RATE_LIMIT'
      ? 'No es una limitación Pro. Instagram ha rechazado esta consulta. No pulses conectar repetidamente; la espera no garantiza que la restricción haya terminado.'
      : 'Abre Instagram y completa cualquier inicio de sesión o verificación pendiente. Después, vuelve a intentarlo aquí.'}</p>
    {issue.endpoint && <p className="connection-diagnostic">Consulta: <code>{issue.endpoint}</code>{issue.status && <> · HTTP {issue.status}</>}. Sin cookies ni credenciales en el diagnóstico.</p>}
    <div className="connection-problem-actions"><span>{remaining > 0 ? `Puedes volver a intentarlo en ${elapsed(remaining)}.` : 'No se reintenta la conexión sin tu confirmación.'}</span><a className="button secondary" href="https://www.instagram.com/" target="_blank" rel="noreferrer">Abrir Instagram <ArrowUpRight size={14} /></a><button className="button primary" disabled={disabled || remaining > 0} onClick={retry}><RefreshCw size={15} />Volver a intentar</button></div>
  </section>;
}

function ScanProgress({ scan, now, disabled, control, accountName }: { scan: ScanSummary; now: number; disabled: boolean; control: (action: 'pause' | 'resume' | 'cancel') => void; accountName?: string }) {
  const count = scan.followers + scan.following;
  const total = (scan.expectedFollowers ?? 0) + (scan.mode === 'full' ? scan.expectedFollowing ?? 0 : 0);
  const percent = total ? Math.min(99, Math.round(count / total * 100)) : 0;
  const waiting = scan.errorCode === 'RATE_LIMIT' && scan.dueAt > now;
  return <section className={`scan-progress panel ${scan.status === 'paused' ? 'is-paused' : ''}`} aria-label="Progreso del escaneo"><div className="scan-progress-top"><span className="scan-progress-icon">{scan.status === 'running' && !waiting ? <RefreshCw size={20} className="spin" /> : <Pause size={20} />}</span><div className="scan-progress-title"><strong>{waiting ? 'En espera por un límite de Instagram' : scan.status === 'running' ? scan.phase === 'verify' ? 'Validando tu captura…' : `Escaneando ${scan.phase === 'followers' ? 'seguidores' : 'seguidos'}…` : 'Escaneo en pausa'} <small>@{accountName}</small></strong><span>{number(count)} cuentas procesadas{total > 0 ? ` de ${number(total)} estimadas` : ''} · {scan.requests} peticiones · {elapsed((now - scan.startedAt) / 1000)}</span></div><div className="scan-progress-actions"><button className="button small secondary" disabled={disabled || (waiting && scan.status === 'paused')} onClick={() => control(scan.status === 'running' ? 'pause' : 'resume')}>{scan.status === 'running' ? <Pause size={14} /> : <Play size={14} />}{scan.status === 'running' ? 'Pausar' : 'Reanudar'}</button><button className="icon-button" aria-label="Cancelar escaneo" disabled={disabled} onClick={() => control('cancel')}><X size={18} /></button></div></div><div className={`progress-track ${total ? '' : 'indeterminate'}`}><span style={{ width: `${Math.max(3, percent)}%` }} /></div>{waiting && <p className="progress-wait"><Clock3 size={14} />{scan.status === 'running' ? 'Reintento automático' : 'Podrás reanudar'} en {elapsed(Math.ceil((scan.dueAt - now) / 1000))}. El avance se conserva.</p>}{scan.error && <p className="progress-error"><Info size={14} />{scan.error}</p>}</section>;
}

function BatchProgress({ job, disabled, control }: { job: BatchJob; disabled: boolean; control: (action: 'pause' | 'resume' | 'cancel') => void }) {
  if (job.status === 'cancelled') return null;
  const done = job.items.filter(item => item.status === 'succeeded').length;
  const failed = job.items.filter(item => ['failed', 'unknown'].includes(item.status));
  const active = ['running', 'paused'].includes(job.status);
  return <section className="batch-progress panel"><div className="scan-progress-top"><span className="scan-progress-icon">{active ? <Users size={20} /> : <CheckCircle2 size={20} />}</span><div className="scan-progress-title"><strong>{job.status === 'running' ? 'Procesando acciones' : job.status === 'paused' ? 'Lote en pausa' : 'Lote finalizado'}</strong><span>{done} de {job.items.length} confirmadas{failed.length > 0 && ` · ${failed.length} sin confirmar`} · {job.action === 'follow' ? 'Seguir' : job.action === 'unfollow' ? 'Dejar de seguir' : 'Eliminar seguidores'}</span></div>{active && <div className="scan-progress-actions"><button className="button small secondary" disabled={disabled} onClick={() => control(job.status === 'running' ? 'pause' : 'resume')}>{job.status === 'running' ? 'Pausar' : 'Continuar pendientes'}</button><button className="icon-button" aria-label="Cancelar lote" disabled={disabled} onClick={() => control('cancel')}><X size={18} /></button></div>}</div>{job.error && <p className="progress-error"><Info size={14} />{job.error}</p>}{failed.length > 0 && <details className="batch-details"><summary>Ver cuentas sin confirmar</summary>{failed.map(item => <p key={item.user.id}><strong>@{item.user.username}</strong> · {item.message}</p>)}</details>}</section>;
}
