import { ButtonHTMLAttributes, FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiRequest,
  clearAccessToken,
  getApiUrl,
  getAccessToken,
  getPreferredAuthScope,
  sessionExpiredEvent,
  setAccessToken,
} from "./services/api";
import { AppIcon, GoogleIcon } from "./components/AppIcon";
import { BrandLogo } from "./components/BrandLogo";
import { descriptionForPublicEvent, Evento360Publico, imageForEvent } from "./pages/Evento360Publico";
import {
  accessDecision,
  type AccountProfile,
  matchRoute,
  navigate,
  paths,
  type UserRole,
} from "./routing";
import "./styles.css";

type ParticipantAccount = {
  id: string;
  username: string;
  name: string;
  email: string;
  createdAt: string;
};
type Organizer = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};
type AccountIdentity = Organizer | ParticipantAccount;
type AdminEvent = {
  id: string;
  name: string;
  date: string;
  location: string;
  capacity: number;
  status: "DRAFT" | "PUBLISHED";
  publicId: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type PublicEvent = {
  publicId: string;
  name: string;
  date: string;
  location: string;
  capacity: number;
  availableSeats: number;
  isFull: boolean;
};
type RegistrationStatus = "ACTIVE" | "CANCELLED" | "WAITLISTED";
type Participant = {
  id: string;
  participantName: string;
  participantEmail: string;
  participantPhone: string | null;
  status: RegistrationStatus;
  checkedInAt?: string | null;
  confirmationCode?: string | null;
};
type ParticipantDashboard = {
  event: AdminEvent;
  metrics: { capacity: number; activeRegistrations: number; availableSeats: number };
  participants: Participant[];
};
type CheckInMetrics = { activeRegistrations: number; checkIns: number; pending: number };
type Confirmation = {
  participantName: string;
  confirmationCode: string;
  status: RegistrationStatus;
  createdAt: string;
  cancelledAt: string | null;
  checkedInAt: string | null;
  waitlistPosition: number | null;
  event: {
    name: string;
    publicId: string;
    date: string;
    location: string;
  };
};
type CancellableRegistration = {
  participantName: string;
  status: RegistrationStatus;
  cancelledAt: string | null;
  event: { name: string; publicId: string };
};
type ParticipantEventRegistration = {
  id: string;
  status: RegistrationStatus;
  confirmationCode: string | null;
  cancellationToken: string | null;
  createdAt: string;
  cancelledAt: string | null;
  event: {
    publicId: string;
    name: string;
    date: string;
    location: string;
    capacity: number;
    available: boolean;
  };
};

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function messageFrom(error: unknown) {
  return error instanceof ApiError ? error.message : "Não foi possível concluir a solicitação.";
}

function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "E";
}

function userDisplayName(user: AccountIdentity) {
  return ("name" in user ? user.name.trim() : "") || user.username || user.email.split("@")[0];
}

function accountDestination() {
  const scope = getPreferredAuthScope();
  if (scope === "participant") return paths.participantEvents;
  if (scope === "organizer") return paths.adminEvents;
  return paths.login;
}

function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Alert({ children, kind = "error" }: { children: ReactNode; kind?: "error" | "success" }) {
  return <p className={`alert alert-${kind}`}>{children}</p>;
}

const registrationStatusBadges: Record<RegistrationStatus, { className: string; participantLabel: string; organizerLabel: string }> = {
  ACTIVE: { className: "badge-green", participantLabel: "Inscrição ativa", organizerLabel: "Confirmado" },
  WAITLISTED: { className: "badge-gold", participantLabel: "Lista de espera", organizerLabel: "Lista de espera" },
  CANCELLED: { className: "badge-gray", participantLabel: "Inscrição cancelada", organizerLabel: "Cancelado" },
};

function RegistrationBadge({ status, organizer = false }: { status: RegistrationStatus; organizer?: boolean }) {
  const badge = registrationStatusBadges[status];
  return <span className={`badge ${badge.className}`}>{organizer ? badge.organizerLabel : badge.participantLabel}</span>;
}

function AuthShell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return <main className="login-page">
    <section className="login-form-panel">
      <BrandLogo onClick={() => navigate(paths.home)} />
      <div className="login-box">
        <span className="badge badge-blue">Vale do São Francisco</span>
        <h1>{title}</h1>
        <p>{intro}</p>
        {children}
      </div>
    </section>
    <aside className="login-hero">
      <div className="hero-copy">
        <span className="badge badge-glass">Tecnologia que conecta o Vale</span>
        <h2>Eventos que movimentam pessoas e experiências.</h2>
        <p>Uma plataforma inspirada no Rio São Francisco, criada para organizar, divulgar e acompanhar eventos de forma simples e profissional.</p>
      </div>
    </aside>
  </main>;
}

function RoleSelectionPage({ organizer, participant }: { organizer: Organizer | null; participant: ParticipantAccount | null }) {
  return <main className="gate-page">
    <nav className="gate-nav">
      <BrandLogo onClick={() => navigate(paths.home)} />
      <button className="gate-home-link" onClick={() => navigate(paths.home)} type="button"><AppIcon name="compass" size={15} /> Explorar eventos</button>
    </nav>
    <section className="gate-content">
      <span className="territory-pill"><AppIcon name="sparkles" size={16} /> Conexões que movem o Vale</span>
      <h1>Como você deseja usar o Evento360?</h1>
      <p>Entre para acompanhar suas inscrições ou para criar e administrar eventos.</p>
      <div className="role-grid">
        <button className="role-card participant-role" onClick={() => navigate(participant ? paths.participantEvents : paths.participantLogin)} type="button">
          <span className="role-icon"><AppIcon name="compass" size={27} /></span><h2>Sou Participante</h2>
          <p>Veja exclusivamente os eventos em que você está inscrito e acesse os detalhes de cada experiência.</p>
          <strong>{participant ? `Continuar como ${userDisplayName(participant)}` : "Entrar como participante"} <AppIcon name="arrow-right" size={17} /></strong>
        </button>
        <button className="role-card organizer-role" onClick={() => navigate(organizer ? paths.adminEvents : paths.organizerLogin)} type="button">
          <span className="role-icon"><AppIcon name="plus" size={28} /></span><h2>Sou Organizador</h2>
          <p>Crie seus eventos, acompanhe participantes e organize cada detalhe em um só lugar.</p>
          <strong>{organizer ? `Continuar como ${userDisplayName(organizer)}` : "Entrar como organizador"} <AppIcon name="arrow-right" size={17} /></strong>
        </button>
      </div>
      <button className="gate-find-link" onClick={() => navigate(paths.eventLookup)} type="button"><AppIcon name="search" size={16} /> Consultar comprovante de inscrição</button>
    </section>
  </main>;
}

function LoginPage({ profile, onLoggedIn }: { profile: AccountProfile; onLoggedIn: (account: AccountIdentity) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("google_token");
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(null);
    setAccessToken(token, profile);
    const endpoint = profile === "participant" ? "/api/public/auth/me" : "/api/admin/auth/me";
    apiRequest<{ participant?: ParticipantAccount; organizer?: Organizer }>(endpoint, { auth: profile })
      .then((result) => {
        if (!active) return;
        onLoggedIn((profile === "participant" ? result.participant : result.organizer) as AccountIdentity);
        navigate(profile === "participant" ? paths.participantEvents : paths.adminEvents, { replace: true });
      })
      .catch((requestError) => { clearAccessToken(profile); if (active) setError(messageFrom(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    window.history.replaceState({}, "", window.location.pathname);
    return () => { active = false; };
  }, [onLoggedIn, profile]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (profile === "participant") {
        const result = await apiRequest<{ token: string; participant: ParticipantAccount }>("/api/public/auth/login", {
          method: "POST",
          body: JSON.stringify({ identifier, password }),
        });
        setAccessToken(result.token, "participant");
        onLoggedIn(result.participant);
        navigate(paths.participantEvents);
      } else {
        const result = await apiRequest<{ token: string; organizer: Organizer }>("/api/admin/auth/login", {
          method: "POST",
          body: JSON.stringify({ identifier, password }),
        });
        setAccessToken(result.token, "organizer");
        onLoggedIn(result.organizer);
        navigate(paths.adminEvents);
      }
    } catch (requestError) {
      setError(messageFrom(requestError));
    } finally {
      setLoading(false);
    }
  }

  const participantLogin = profile === "participant";
  return <AuthShell intro={participantLogin ? "Acompanhe suas inscrições, códigos de confirmação e eventos em um só lugar." : "Gerencie seus eventos com facilidade, do planejamento ao check-in."} title={participantLogin ? "Entrar como participante" : "Entrar como organizador"}>
        <form onSubmit={submit}>
          <Field label="Login ou e-mail">
            <input autoComplete="username" disabled={loading} onChange={(event) => setIdentifier(event.target.value)} placeholder="admin, teste ou voce@email.com" required value={identifier} />
          </Field>
          <Field label="Senha">
            <input autoComplete="current-password" disabled={loading} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" required type="password" value={password} />
          </Field>
          {error ? <Alert>{error}</Alert> : null}
          <div className="login-options"><label><input type="checkbox" /> Lembrar acesso</label><button onClick={() => navigate(paths.forgotPassword(profile))} type="button">Esqueci minha senha</button></div>
          <Button className="button-primary button-block" disabled={loading} type="submit">{loading ? "Entrando…" : "Entrar"}</Button>
        </form>
        <div className="auth-divider"><span>ou</span></div>
        <Button className="google-button button-block" disabled={loading} onClick={() => { window.location.assign(getApiUrl(profile === "participant" ? "/api/public/auth/google" : "/api/admin/auth/google")); }} type="button"><GoogleIcon /> Continuar com Google</Button>
        {participantLogin ? <p className="signup-prompt">Ainda não possui uma conta? <button onClick={() => navigate(paths.signup)} type="button">Criar conta</button></p> : null}
        <p className="signup-prompt"><button onClick={() => navigate(participantLogin ? paths.organizerLogin : paths.participantLogin)} type="button">Entrar como {participantLogin ? "organizador" : "participante"}</button> · <button onClick={() => navigate(paths.home)} type="button">Voltar aos eventos</button></p>
  </AuthShell>;
}

function SignUpPage({ onLoggedIn }: { onLoggedIn: (participant: ParticipantAccount) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) { setError("A confirmação de senha não confere."); return; }
    setLoading(true); setError(null);
    try {
      const result = await apiRequest<{ token: string; participant: ParticipantAccount }>("/api/public/auth/register", { method: "POST", body: JSON.stringify({ username, name, email, password }) });
      setAccessToken(result.token, "participant"); onLoggedIn(result.participant); navigate(paths.participantEvents);
    } catch (requestError) { setError(messageFrom(requestError)); } finally { setLoading(false); }
  }
  return <AuthShell intro="Crie gratuitamente seu acesso de participante e acompanhe todas as suas inscrições." title="Criar conta">
    <form onSubmit={submit}>
      <Field label="Nome completo"><input autoComplete="name" disabled={loading} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" required value={name} /></Field>
      <Field label="Login"><input autoComplete="username" disabled={loading} minLength={3} onChange={(event) => setUsername(event.target.value)} placeholder="Escolha seu login" required value={username} /></Field>
      <Field label="E-mail"><input autoComplete="email" disabled={loading} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" required type="email" value={email} /></Field>
      <Field label="Senha"><input autoComplete="new-password" disabled={loading} minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required type="password" value={password} /></Field>
      <Field label="Confirmar senha"><input autoComplete="new-password" disabled={loading} minLength={8} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite a senha novamente" required type="password" value={confirmation} /></Field>
      {error ? <Alert>{error}</Alert> : null}
      <Button className="button-primary button-block" disabled={loading} type="submit">{loading ? "Criando conta…" : "Criar minha conta"}</Button>
    </form>
    <p className="signup-prompt">Já possui uma conta? <button onClick={() => navigate(paths.participantLogin)} type="button">Fazer login</button> · <button onClick={() => navigate(paths.home)} type="button">Voltar aos eventos</button></p>
  </AuthShell>;
}

function ForgotPasswordPage({ profile }: { profile: AccountProfile }) {
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      const endpoint = profile === "participant" ? "/api/public/auth/forgot-password" : "/api/admin/auth/forgot-password";
      await apiRequest<unknown>(endpoint, { method: "POST", body: JSON.stringify({ identifier }) });
      setSent(true);
    } catch (requestError) { setError(messageFrom(requestError)); } finally { setLoading(false); }
  }
  const loginPath = profile === "participant" ? paths.participantLogin : paths.organizerLogin;
  return <AuthShell intro={`Informe o login ou e-mail da sua conta de ${profile === "participant" ? "participante" : "organizador"}.`} title="Recuperar senha">
    {sent ? <><Alert kind="success">Se a conta existir, enviaremos as instruções de recuperação para o e-mail cadastrado.</Alert><Button className="button-secondary button-block" onClick={() => navigate(loginPath)}>Voltar ao login</Button></> : <form onSubmit={submit}>
      <Field label="Login ou e-mail"><input autoComplete="username" disabled={loading} onChange={(event) => setIdentifier(event.target.value)} placeholder="Seu login ou e-mail" required value={identifier} /></Field>
      {error ? <Alert>{error}</Alert> : null}
      <Button className="button-primary button-block" disabled={loading} type="submit">{loading ? "Enviando…" : "Enviar instruções"}</Button>
      <p className="signup-prompt"><button onClick={() => navigate(loginPath)} type="button">Voltar ao login</button> · <button onClick={() => navigate(paths.home)} type="button">Ir aos eventos</button></p>
    </form>}
  </AuthShell>;
}

function ResetPasswordPage({ profile, token }: { profile: AccountProfile; token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) { setError("A confirmação de senha não confere."); return; }
    setLoading(true); setError(null);
    try {
      const endpoint = profile === "participant" ? "/api/public/auth/reset-password" : "/api/admin/auth/reset-password";
      await apiRequest<void>(endpoint, { method: "POST", body: JSON.stringify({ token, password }) });
      setDone(true);
    } catch (requestError) { setError(messageFrom(requestError)); } finally { setLoading(false); }
  }
  const loginPath = profile === "participant" ? paths.participantLogin : paths.organizerLogin;
  return <AuthShell intro={`Defina uma nova senha para sua conta de ${profile === "participant" ? "participante" : "organizador"}.`} title="Redefinir senha">
    {done ? <><Alert kind="success">Senha redefinida com sucesso.</Alert><Button className="button-primary button-block" onClick={() => navigate(loginPath)}>Fazer login</Button></> : <form onSubmit={submit}>
      <Field label="Nova senha"><input autoComplete="new-password" disabled={loading} minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required type="password" value={password} /></Field>
      <Field label="Confirmar nova senha"><input autoComplete="new-password" disabled={loading} minLength={8} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite a senha novamente" required type="password" value={confirmation} /></Field>
      {error ? <Alert>{error}</Alert> : null}
      <Button className="button-primary button-block" disabled={loading} type="submit">{loading ? "Salvando…" : "Salvar nova senha"}</Button>
    </form>}
  </AuthShell>;
}

function AdminLayout({ organizer, children, active, eventId, onLogout }: { organizer: Organizer; children: ReactNode; active: "events" | "new" | "participants" | "checkin"; eventId?: string; onLogout: () => void }) {
  return <div className="admin-layout">
    <aside className="sidebar">
      <BrandLogo dark onClick={() => navigate("/admin/events")} />
      <nav className="sidebar-menu">
        <button className={active === "events" ? "active" : ""} onClick={() => navigate("/admin/events")} title="Meus eventos" type="button"><AppIcon name="home" /><span>Meus eventos</span></button>
        <button className={active === "new" ? "active" : ""} onClick={() => navigate("/admin/events/new")} title="Criar evento" type="button"><AppIcon name="plus" /><span>Criar evento</span></button>
        <button className={active === "participants" ? "active" : ""} onClick={() => navigate(eventId ? `/admin/events/${eventId}/participants` : paths.adminParticipants)} title="Participantes" type="button"><AppIcon name="users" /><span>Participantes</span></button>
        <button className={active === "checkin" ? "active" : ""} onClick={() => navigate(eventId ? `/admin/events/${eventId}/check-in` : paths.adminCheckIn)} title="Check-in" type="button"><AppIcon name="checkin" /><span>Check-in</span></button>
      </nav>
      <div className="sidebar-user"><span className="avatar">{initials(userDisplayName(organizer))}</span><div><strong>{userDisplayName(organizer)}</strong><small>Organizador</small></div></div>
      <button className="sidebar-logout" onClick={onLogout} type="button"><AppIcon name="logout" /><span>Sair</span></button>
    </aside>
    <main className="admin-main">
      <header className="topbar"><span>Evento360 • Vale do São Francisco</span><div><span>{organizer.username} • Organizador</span><i className="avatar small">{initials(userDisplayName(organizer))}</i></div></header>
      <div className="brand-stripe" />
      <section className="admin-content">{children}</section>
    </main>
  </div>;
}

function PageTitle({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <header className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</header>;
}

function Metric({ title, value, detail }: { title: string; value: string | number; detail?: string }) {
  return <article className="metric-card"><span>{title}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

function EventListPage({ organizer, onLogout }: { organizer: Organizer; onLogout: () => void }) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    apiRequest<{ events: AdminEvent[] }>("/api/admin/events", { auth: "organizer" })
      .then((result) => mounted && setEvents(result.events))
      .catch((requestError) => mounted && setError(messageFrom(requestError)))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);
  async function removeEvent(eventId: string) {
    setDeletingId(eventId); setError(null);
    try {
      await apiRequest<void>(`/api/admin/events/${eventId}`, { method: "DELETE", auth: "organizer" });
      setEvents((current) => current.filter((event) => event.id !== eventId));
      setConfirmDeleteId(null);
    } catch (requestError) { setError(messageFrom(requestError)); } finally { setDeletingId(null); }
  }
  const published = events.filter((event) => event.status === "PUBLISHED").length;
  return <AdminLayout active="events" onLogout={onLogout} organizer={organizer}>
    <PageTitle title={`Olá, ${userDisplayName(organizer)} 👋`} subtitle="Veja como estão seus eventos no Vale." actions={<Button className="button-primary" onClick={() => navigate("/admin/events/new")}><AppIcon name="plus" size={18} /> Adicionar evento</Button>} />
    <div className="metrics-grid"><Metric detail="Eventos cadastrados" title="Eventos ativos" value={published} /><Metric detail="Aguardando publicação" title="Rascunhos" value={events.length - published} /><Metric detail="No seu painel" title="Total de eventos" value={events.length} /><Metric detail="Área administrativa" title="Conta" value="Ativa" /></div>
    <PageTitle title="Próximos eventos" subtitle="Acompanhe inscrições e capacidade." />
    {loading ? <p className="loading-text">Carregando eventos…</p> : null}
    {error ? <Alert>{error}</Alert> : null}
    {!loading && !error && events.length === 0 ? <div className="empty-state">Você ainda não criou eventos.<Button className="button-primary" onClick={() => navigate("/admin/events/new")}>Criar primeiro evento</Button></div> : null}
    <div className="event-grid">{events.map((event, index) => <article className="event-card" key={event.id}>
      <div className={`event-cover ${event.status === "DRAFT" ? "event-cover-draft" : ""}`}><img alt="" src={imageForEvent(event, index)} /></div>
      <span className={`badge ${event.status === "PUBLISHED" ? "badge-blue" : "badge-gray"}`}>{event.status === "PUBLISHED" ? "Publicado" : "Rascunho"}</span>
      <h3>{event.name}</h3>
      <div className="event-info"><span><AppIcon name="calendar" size={17} /> {dateFormat.format(new Date(event.date))}</span><span><AppIcon name="map-pin" size={17} /> {event.location}</span><span><AppIcon name="users" size={17} /> Capacidade para {event.capacity} pessoas</span></div>
      <div className="button-row"><Button className="button-primary" onClick={() => navigate(`/admin/events/${event.id}`)}>Gerenciar</Button><Button className="button-secondary" onClick={() => navigate(`/admin/events/${event.id}/edit`)}>Editar</Button>{event.status === "PUBLISHED" ? <Button className="button-secondary" onClick={() => navigate(`/event/${event.publicId}`)}>Ver página</Button> : null}<Button className="button-danger" disabled={deletingId === event.id} onClick={() => setConfirmDeleteId(event.id)}>Remover</Button></div>
      {confirmDeleteId === event.id ? <div className="event-delete-confirm" role="alert"><strong>Remover este evento?</strong><p>Ele sairá da sua lista e não ficará mais disponível ao público.</p><div className="button-row"><Button className="button-danger" disabled={deletingId === event.id} onClick={() => removeEvent(event.id)}>{deletingId === event.id ? "Removendo…" : "Confirmar remoção"}</Button><Button className="button-secondary" disabled={deletingId === event.id} onClick={() => setConfirmDeleteId(null)}>Cancelar</Button></div></div> : null}
    </article>)}</div>
  </AdminLayout>;
}

function AdminEventSelectorPage({ mode, organizer, onLogout }: { mode: "participants" | "checkin"; organizer: Organizer; onLogout: () => void }) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    apiRequest<{ events: AdminEvent[] }>("/api/admin/events", { auth: "organizer" })
      .then((result) => mounted && setEvents(result.events))
      .catch((requestError) => mounted && setError(messageFrom(requestError)))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const participantsMode = mode === "participants";
  return <AdminLayout active={mode} onLogout={onLogout} organizer={organizer}>
    <PageTitle
      title={participantsMode ? "Participantes" : "Check-in"}
      subtitle={participantsMode ? "Escolha um evento para consultar sua lista de inscritos." : "Escolha um evento para localizar participantes e registrar presenças."}
      actions={<Button className="button-primary" onClick={() => navigate(paths.adminEvents)}><AppIcon name="home" size={17} /> Meus eventos</Button>}
    />
    {loading ? <p className="loading-text">Carregando eventos…</p> : null}
    {error ? <Alert>{error}</Alert> : null}
    {!loading && !error && events.length === 0 ? <div className="empty-state">Você ainda não possui eventos.<Button className="button-primary" onClick={() => navigate("/admin/events/new")}>Criar evento</Button></div> : null}
    <div className="event-grid">{events.map((event, index) => <article className="event-card" key={event.id}>
      <div className={`event-cover ${event.status === "DRAFT" ? "event-cover-draft" : ""}`}><img alt="" src={imageForEvent(event, index)} /></div>
      <span className={`badge ${event.status === "PUBLISHED" ? "badge-blue" : "badge-gray"}`}>{event.status === "PUBLISHED" ? "Publicado" : "Rascunho"}</span>
      <h3>{event.name}</h3>
      <div className="event-info"><span><AppIcon name="calendar" size={17} /> {dateFormat.format(new Date(event.date))}</span><span><AppIcon name="map-pin" size={17} /> {event.location}</span></div>
      <Button className="button-primary" onClick={() => navigate(`/admin/events/${event.id}/${participantsMode ? "participants" : "check-in"}`)}>{participantsMode ? <><AppIcon name="users" size={17} /> Ver participantes</> : <><AppIcon name="checkin" size={17} /> Abrir check-in</>}</Button>
    </article>)}</div>
  </AdminLayout>;
}

type MockAddress = { street: string; neighborhood: string; city: string; label: string; x: string; y: string; terms: string[] };

const mockAddresses: MockAddress[] = [
  { street: "Avenida Cardoso de Sá", neighborhood: "Centro", city: "Petrolina - PE", label: "Orla de Petrolina", x: "64%", y: "57%", terms: ["orla", "cardoso", "petrolina"] },
  { street: "Avenida Antônio Carlos Magalhães", neighborhood: "Santo Antônio", city: "Juazeiro - BA", label: "Campus da UNIVASF", x: "38%", y: "45%", terms: ["univasf", "universidade", "juazeiro"] },
  { street: "Avenida Transnordestina", neighborhood: "Antônio Cassimiro", city: "Petrolina - PE", label: "Centro de Convenções do Vale", x: "57%", y: "42%", terms: ["centro", "conven", "senai"] },
];

function locateMockAddress(query: string): MockAddress {
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return mockAddresses.find((address) => address.terms.some((term) => normalized.includes(term))) ?? {
    street: query,
    neighborhood: "Centro",
    city: "Petrolina - PE",
    label: query,
    x: "52%",
    y: "55%",
    terms: [],
  };
}

type EventFormValues = { name: string; date: string; location: string; capacity: number };

// `datetime-local` trabalha no fuso do navegador, sem offset.
function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function EventForm({ initial, submitLabel, submittingLabel, onSubmit }: { initial?: AdminEvent; submitLabel: string; submittingLabel: string; onSubmit: (values: EventFormValues) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initial ? toDateTimeLocal(initial.date) : "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [addressQuery, setAddressQuery] = useState("");
  const [address, setAddress] = useState<MockAddress | null>(null);
  const [capacity, setCapacity] = useState(initial ? String(initial.capacity) : "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  function searchAddress() {
    const query = addressQuery.trim();
    if (!query) { setError("Digite um endereço, bairro ou ponto de referência para buscar no mapa."); return; }
    const selectedAddress = locateMockAddress(query);
    setAddress(selectedAddress);
    setLocation(selectedAddress.label);
    setError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCapacity = Number(capacity);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) { setError("Informe uma capacidade inteira maior que zero."); return; }
    if (!location) { setError("Busque e confirme o local do evento no mapa."); return; }
    setLoading(true); setError(null);
    try {
      await onSubmit({ name, date: new Date(date).toISOString(), location, capacity: parsedCapacity });
    } catch (requestError) { setError(messageFrom(requestError)); } finally { setLoading(false); }
  }
  return <form className="form-card" onSubmit={submit}>
      <div className="form-grid"><Field label="Nome do evento"><input disabled={loading} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Conecta Vale 2026" required value={name} /></Field><div className="location-picker"><span>Local do evento</span><div className="address-search"><input disabled={loading} onChange={(event) => setAddressQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchAddress(); } }} placeholder="Busque por rua, bairro ou ponto de referência" value={addressQuery} /><Button className="button-secondary" disabled={loading} onClick={searchAddress} type="button">Buscar no mapa</Button></div><div className="map-mock" role="img" aria-label="Mapa simulado para localização do evento"><span className="map-status">{address ? `Marcador posicionado em ${address.label}.` : location ? `Local atual: ${location}. Busque um endereço para alterá-lo.` : "Busque um endereço para posicionar o marcador."}</span>{address ? <i className="map-marker" style={{ left: address.x, top: address.y }} /> : null}</div><div className="address-details"><Field label="Rua"><input readOnly value={address?.street ?? ""} placeholder="Preenchido pela busca" /></Field><Field label="Bairro"><input readOnly value={address?.neighborhood ?? ""} placeholder="Preenchido pela busca" /></Field><Field label="Cidade"><input readOnly value={address?.city ?? ""} placeholder="Preenchido pela busca" /></Field></div><Field label="Local confirmado"><input readOnly required value={location} placeholder="O local selecionado aparecerá aqui" /></Field></div><Field label="Data e horário"><input disabled={loading} onChange={(event) => setDate(event.target.value)} required type="datetime-local" value={date} /></Field><Field label="Capacidade máxima"><input disabled={loading} min="1" onChange={(event) => setCapacity(event.target.value)} placeholder="120" required step="1" type="number" value={capacity} /></Field></div>
      {error ? <Alert>{error}</Alert> : null}
      <footer className="form-actions"><Button className="button-secondary" onClick={() => navigate(initial ? `/admin/events/${initial.id}` : "/admin/events")} type="button">Cancelar</Button><Button className="button-primary" disabled={loading} type="submit">{loading ? submittingLabel : submitLabel}</Button></footer>
    </form>;
}

function NewEventPage({ organizer, onLogout }: { organizer: Organizer; onLogout: () => void }) {
  async function create(values: EventFormValues) {
    const result = await apiRequest<{ event: AdminEvent }>("/api/admin/events", { method: "POST", auth: "organizer", body: JSON.stringify(values) });
    navigate(`/admin/events/${result.event.id}`);
  }
  return <AdminLayout active="new" onLogout={onLogout} organizer={organizer}>
    <PageTitle title="Criar novo evento" subtitle="Cadastre as informações principais para começar." />
    <EventForm onSubmit={create} submitLabel="Criar evento" submittingLabel="Criando…" />
  </AdminLayout>;
}

function EditEventPage({ eventId, organizer, onLogout }: { eventId: string; organizer: Organizer; onLogout: () => void }) {
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let mounted = true; apiRequest<{ event: AdminEvent }>(`/api/admin/events/${eventId}`, { auth: "organizer" }).then((result) => mounted && setEvent(result.event)).catch((requestError) => mounted && setError(messageFrom(requestError))).finally(() => mounted && setLoading(false)); return () => { mounted = false; }; }, [eventId]);
  async function save(values: EventFormValues) {
    await apiRequest<{ event: AdminEvent }>(`/api/admin/events/${eventId}`, { method: "PUT", auth: "organizer", body: JSON.stringify(values) });
    navigate(`/admin/events/${eventId}`);
  }
  return <AdminLayout active="events" eventId={eventId} onLogout={onLogout} organizer={organizer}>
    <PageTitle title="Editar evento" subtitle={event?.status === "PUBLISHED" ? "O evento está publicado: as alterações aparecem imediatamente na página pública." : "Atualize as informações principais do evento."} />
    {loading ? <p className="loading-text">Carregando evento…</p> : null}{error ? <Alert>{error}</Alert> : null}
    {event ? <EventForm initial={event} key={event.id} onSubmit={save} submitLabel="Salvar alterações" submittingLabel="Salvando…" /> : null}
  </AdminLayout>;
}

function EventManagementPage({ eventId, organizer, onLogout }: { eventId: string; organizer: Organizer; onLogout: () => void }) {
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishedNow, setPublishedNow] = useState(false);
  useEffect(() => { let mounted = true; apiRequest<{ event: AdminEvent }>(`/api/admin/events/${eventId}`, { auth: "organizer" }).then((result) => mounted && setEvent(result.event)).catch((requestError) => mounted && setError(messageFrom(requestError))).finally(() => mounted && setLoading(false)); return () => { mounted = false; }; }, [eventId]);
  async function publish() { setPublishing(true); setError(null); try { const result = await apiRequest<{ event: AdminEvent }>(`/api/admin/events/${eventId}/publish`, { method: "POST", auth: "organizer" }); setEvent(result.event); setPublishedNow(true); } catch (requestError) { setError(messageFrom(requestError)); } finally { setPublishing(false); } }
  const publicUrl = event?.status === "PUBLISHED" ? `${window.location.origin}/event/${event.publicId}` : null;
  return <AdminLayout active="events" eventId={eventId} onLogout={onLogout} organizer={organizer}>
    {loading ? <p className="loading-text">Carregando evento…</p> : null}{error ? <Alert>{error}</Alert> : null}
    {event ? <><PageTitle title={event.name} subtitle={`${dateFormat.format(new Date(event.date))} • ${event.location}`} actions={<div className="button-row"><Button className="button-secondary" onClick={() => navigate(`/admin/events/${event.id}/edit`)}>Editar</Button><Button className="button-secondary" onClick={() => navigate(`/admin/events/${event.id}/participants`)}><AppIcon name="users" size={17} /> Participantes</Button><Button className="button-secondary" onClick={() => navigate(`/admin/events/${event.id}/check-in`)}><AppIcon name="checkin" size={17} /> Check-in</Button>{event.status === "DRAFT" ? <Button className="button-primary" disabled={publishing} onClick={publish}>{publishing ? "Publicando…" : "Publicar evento"}</Button> : null}</div>} />
      <div className="event-status-row"><span className={`badge ${event.status === "PUBLISHED" ? "badge-blue" : "badge-gray"}`}>{event.status === "PUBLISHED" ? "Publicado" : "Rascunho"}</span><span>Capacidade máxima: <strong>{event.capacity}</strong></span></div>
      {publicUrl ? <div className="link-card"><strong>{publishedNow ? "Evento publicado com sucesso" : "Link público do evento"}</strong><p>{publicUrl}</p><Button className="button-secondary" onClick={() => navigator.clipboard?.writeText(publicUrl)}>Copiar link</Button></div> : null}</> : null}
  </AdminLayout>;
}

function ParticipantsPage({ eventId, organizer, onLogout }: { eventId: string; organizer: Organizer; onLogout: () => void }) {
  const [data, setData] = useState<ParticipantDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let mounted = true; apiRequest<ParticipantDashboard>(`/api/admin/events/${eventId}/participants`, { auth: "organizer" }).then((result) => mounted && setData(result)).catch((requestError) => mounted && setError(messageFrom(requestError))).finally(() => mounted && setLoading(false)); return () => { mounted = false; }; }, [eventId]);
  return <AdminLayout active="participants" eventId={eventId} onLogout={onLogout} organizer={organizer}>
    {loading ? <p className="loading-text">Carregando participantes…</p> : null}{error ? <Alert>{error}</Alert> : null}
    {data ? <><PageTitle title={data.event.name} subtitle={`${dateFormat.format(new Date(data.event.date))} • ${data.event.location}`} actions={<Button className="button-secondary" onClick={() => navigate(`/admin/events/${eventId}`)}><AppIcon name="arrow-left" size={17} /> Voltar</Button>} />
      <div className="metrics-grid"><Metric title="Capacidade" value={data.metrics.capacity} /><Metric title="Inscritos" value={data.metrics.activeRegistrations} /><Metric title="Vagas disponíveis" value={data.metrics.availableSeats} /><Metric title="Lista de espera" value={data.participants.filter((participant) => participant.status === "WAITLISTED").length} detail="Chamados por ordem de chegada" /></div>
      <div className="table-card"><header><div><h2>Participantes</h2><p>{data.metrics.activeRegistrations} inscrições ativas</p></div></header>{data.participants.length === 0 ? <div className="empty-state">Ainda não há inscritos neste evento.</div> : <div className="table-scroll"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Status</th><th>Check-in</th></tr></thead><tbody>{data.participants.map((participant) => <tr key={participant.id}><td><strong>{participant.participantName}</strong>{participant.confirmationCode ? <small>{participant.confirmationCode}</small> : null}</td><td>{participant.participantEmail}</td><td>{participant.participantPhone || "—"}</td><td><RegistrationBadge organizer status={participant.status} /></td><td>{participant.status === "ACTIVE" ? <span className={`badge ${participant.checkedInAt ? "badge-green" : "badge-gray"}`}>{participant.checkedInAt ? "Presente" : "Pendente"}</span> : "—"}</td></tr>)}</tbody></table></div>}</div></> : null}
  </AdminLayout>;
}

function CheckInPage({ eventId, organizer, onLogout }: { eventId: string; organizer: Organizer; onLogout: () => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [metrics, setMetrics] = useState<CheckInMetrics | null>(null);
  const [registrations, setRegistrations] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  useEffect(() => { let mounted = true; setLoading(true); apiRequest<{ metrics: CheckInMetrics; registrations: Participant[] }>(`/api/admin/events/${eventId}/check-in?query=${encodeURIComponent(query)}`, { auth: "organizer" }).then((result) => { if (mounted) { setMetrics(result.metrics); setRegistrations(result.registrations); } }).catch((requestError) => mounted && setError(messageFrom(requestError))).finally(() => mounted && setLoading(false)); return () => { mounted = false; }; }, [eventId, query]);
  async function checkIn(registration: Participant) { setCheckingId(registration.id); setError(null); try { const result = await apiRequest<{ registration: Participant; metrics: CheckInMetrics }>(`/api/admin/events/${eventId}/registrations/${registration.id}/check-in`, { method: "POST", auth: "organizer" }); setMetrics(result.metrics); setRegistrations((current) => current.map((item) => item.id === result.registration.id ? result.registration : item)); } catch (requestError) { setError(messageFrom(requestError)); } finally { setCheckingId(null); } }
  const attendance = metrics?.activeRegistrations ? `${Math.round((metrics.checkIns / metrics.activeRegistrations) * 100)}%` : "0%";
  return <AdminLayout active="checkin" eventId={eventId} onLogout={onLogout} organizer={organizer}>
    <PageTitle title="Check-in" subtitle="Localize participantes por nome ou código." actions={<Button className="button-secondary" onClick={() => navigate(`/admin/events/${eventId}`)}><AppIcon name="arrow-left" size={17} /> Voltar</Button>} />
    <div className="metrics-grid"><Metric title="Inscritos" value={metrics?.activeRegistrations ?? "—"} /><Metric title="Presentes" value={metrics?.checkIns ?? "—"} /><Metric title="Pendentes" value={metrics?.pending ?? "—"} /><Metric title="Comparecimento" value={attendance} /></div>
    <section className="checkin-card"><form className="checkin-search" onSubmit={(event) => { event.preventDefault(); setQuery(input); }}><input onChange={(event) => setInput(event.target.value)} placeholder="Buscar por nome ou código de inscrição" value={input} /><Button className="button-primary" type="submit"><AppIcon name="search" size={17} /> Buscar</Button></form>{error ? <Alert>{error}</Alert> : null}{loading ? <p className="loading-text">Buscando inscrições…</p> : null}{!loading && query && registrations.length === 0 ? <div className="empty-state">Nenhum participante encontrado.</div> : null}{registrations.map((registration) => <article className="checkin-line" key={registration.id}><div><strong>{registration.participantName}</strong><p>{registration.confirmationCode || "Sem código"} • {registration.participantEmail}</p></div>{registration.status !== "ACTIVE" ? <RegistrationBadge organizer status={registration.status} /> : registration.checkedInAt ? <span className="badge badge-green">Presente</span> : <Button className="button-success" disabled={checkingId === registration.id} onClick={() => checkIn(registration)}>{checkingId === registration.id ? "Registrando…" : <><AppIcon name="check" size={17} /> Fazer check-in</>}</Button>}</article>)}</section>
  </AdminLayout>;
}

function ParticipantLayout({ user, children, onLogout }: { user: ParticipantAccount; children: ReactNode; onLogout: () => void }) {
  return <div className="admin-layout participant-layout">
    <aside className="sidebar">
      <BrandLogo dark onClick={() => navigate(paths.home)} />
      <nav className="sidebar-menu">
        <button className="active" onClick={() => navigate(paths.participantEvents)} type="button"><AppIcon name="ticket" /><span>Minhas inscrições</span></button>
        <button onClick={() => navigate(paths.home)} type="button"><AppIcon name="compass" /><span>Explorar eventos</span></button>
        <button onClick={() => navigate(paths.login)} type="button"><AppIcon name="user" /><span>Trocar perfil</span></button>
      </nav>
      <div className="sidebar-user"><span className="avatar">{initials(userDisplayName(user))}</span><div><strong>{userDisplayName(user)}</strong><small>Participante</small></div></div>
      <button className="sidebar-logout" onClick={onLogout} type="button"><AppIcon name="logout" /><span>Sair</span></button>
    </aside>
    <main className="admin-main">
      <header className="topbar"><span>Evento360 • Vale do São Francisco</span><div><span>{user.username} • Participante</span><i className="avatar small">{initials(userDisplayName(user))}</i><button aria-label="Sair" className="mobile-logout" onClick={onLogout} type="button"><AppIcon name="logout" size={18} /></button></div></header>
      <div className="brand-stripe" />
      <section className="admin-content">{children}</section>
    </main>
  </div>;
}

function ParticipantEventsPage({ user, onLogout }: { user: ParticipantAccount; onLogout: () => void }) {
  const [registrations, setRegistrations] = useState<ParticipantEventRegistration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    apiRequest<{ registrations: ParticipantEventRegistration[] }>("/api/public/auth/me/registrations", { auth: "participant" })
      .then((result) => mounted && setRegistrations(result.registrations))
      .catch((requestError) => mounted && setError(messageFrom(requestError)))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);
  const active = registrations.filter((registration) => registration.status === "ACTIVE").length;
  return <ParticipantLayout onLogout={onLogout} user={user}>
    <PageTitle title={`Olá, ${userDisplayName(user)} 👋`} subtitle="Aqui estão exclusivamente os eventos em que você se inscreveu." actions={<Button className="button-primary" onClick={() => navigate(paths.home)}><AppIcon name="compass" size={18} /> Explorar eventos</Button>} />
    <div className="metrics-grid participant-metrics"><Metric detail="Inscrições confirmadas" title="Eventos ativos" value={active} /><Metric detail="No seu histórico" title="Total de inscrições" value={registrations.length} /></div>
    {loading ? <p className="loading-text">Carregando suas inscrições…</p> : null}
    {error ? <Alert>{error}</Alert> : null}
    {!loading && !error && registrations.length === 0 ? <div className="empty-state"><AppIcon name="ticket" size={30} />Você ainda não está inscrito em nenhum evento.<Button className="button-primary" onClick={() => navigate(paths.home)}>Encontrar um evento</Button></div> : null}
    <div className="event-grid">{registrations.map((registration, index) => <article className="event-card participant-event-card" key={registration.id}>
      <div className="event-cover"><img alt="" src={imageForEvent(registration.event, index)} /></div>
      <div className="participant-event-badges"><RegistrationBadge status={registration.status} />{registration.confirmationCode ? <span className="badge badge-blue">{registration.confirmationCode}</span> : null}</div>
      <h3>{registration.event.name}</h3>
      <div className="event-info"><span><AppIcon name="calendar" size={17} /> {dateFormat.format(new Date(registration.event.date))}</span><span><AppIcon name="map-pin" size={17} /> {registration.event.location}</span><span><AppIcon name="ticket" size={17} /> Inscrito em {dateFormat.format(new Date(registration.createdAt))}</span></div>
      {!registration.event.available ? <Alert>Este evento não está mais disponível publicamente, mas sua inscrição foi preservada.</Alert> : null}
      <div className="button-row"><Button className="button-primary" disabled={!registration.event.available} onClick={() => navigate(`/event/${encodeURIComponent(registration.event.publicId)}`)}>Ver evento</Button>{registration.confirmationCode ? <Button className="button-secondary" onClick={() => navigator.clipboard?.writeText(registration.confirmationCode!)}>Copiar código</Button> : null}{registration.status !== "CANCELLED" && registration.cancellationToken ? <Button className="button-danger" onClick={() => navigate(`/registration/cancel/${encodeURIComponent(registration.cancellationToken!)}`)}>{registration.status === "WAITLISTED" ? "Sair da lista de espera" : "Cancelar inscrição"}</Button> : null}</div>
    </article>)}</div>
  </ParticipantLayout>;
}

function EventLookupPage() {
  const [confirmationCode, setConfirmationCode] = useState("");
  const [registration, setRegistration] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(form: FormEvent<HTMLFormElement>) {
    form.preventDefault();
    const code = confirmationCode.trim().toUpperCase();
    if (!code) return;
    setLoading(true); setError(null); setRegistration(null);
    try {
      const result = await apiRequest<{ registration: Confirmation }>(`/api/public/registrations/confirmation/${encodeURIComponent(code)}`);
      setRegistration(result.registration);
    } catch (requestError) { setError(messageFrom(requestError)); } finally { setLoading(false); }
  }
  return <PublicLayout><section className="lookup-wrap">
    <div className="lookup-heading"><span className="badge badge-blue"><AppIcon name="ticket" size={15} /> Comprovante público</span><h1>Consulte sua inscrição pelo código</h1><p>Inscreveu-se sem criar uma conta? Digite o código de confirmação recebido ao final da inscrição para verificar seu cadastro.</p></div>
    <form className="lookup-form" onSubmit={submit}><Field label="Código da inscrição"><input autoComplete="off" disabled={loading} inputMode="numeric" onChange={(input) => setConfirmationCode(input.target.value)} placeholder="Ex.: 48273105" required value={confirmationCode} /></Field><Button className="button-primary" disabled={loading} type="submit"><AppIcon name="search" size={18} /> {loading ? "Consultando…" : "Consultar inscrição"}</Button></form>
    {error ? <div className="lookup-result lookup-error"><strong>Inscrição não encontrada</strong><p>Confira o código informado. Ele aparece no comprovante exibido após a inscrição e no e-mail de confirmação.</p></div> : null}
    {registration ? <article className="lookup-result registration-proof-preview"><div><RegistrationBadge status={registration.status} /><h2>{registration.event.name}</h2><p><AppIcon name="user" size={17} /> {registration.participantName}</p><p><AppIcon name="calendar" size={17} /> {dateFormat.format(new Date(registration.event.date))}</p><p><AppIcon name="map-pin" size={17} /> {registration.event.location}</p><p><AppIcon name="ticket" size={17} /> Código: {registration.confirmationCode}</p></div><Button className="button-primary" onClick={() => navigate(`/registration/${encodeURIComponent(registration.confirmationCode)}`)}>Abrir comprovante <AppIcon name="arrow-right" size={17} /></Button></article> : null}
  </section></PublicLayout>;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return <main className="session-loading">Redirecionando…</main>;
}

function ForbiddenPage() {
  return <PublicLayout><section className="status-page"><span className="status-code">403</span><h1>O perfil correto precisa ser autenticado</h1><p>As sessões de participante e organizador são independentes para proteger cada área.</p><div className="button-row centered"><Button className="button-primary" onClick={() => navigate(paths.login)}>Escolher perfil</Button><Button className="button-secondary" onClick={() => navigate(paths.home)}>Voltar aos eventos</Button></div></section></PublicLayout>;
}

function NotFoundPage() {
  return <PublicLayout><section className="status-page"><span className="status-code">404</span><h1>Página não encontrada</h1><p>O endereço informado não existe ou foi movido.</p><Button className="button-primary" onClick={() => navigate(paths.home)}>Explorar eventos</Button></section></PublicLayout>;
}

function PublicLayout({ children, back }: { children: ReactNode; back?: () => void }) {
  const destination = accountDestination();
  return <main className="public-page"><nav className="public-nav"><BrandLogo onClick={() => navigate(paths.home)} /><div className="public-nav-actions">{back ? <Button className="button-secondary" onClick={back}><AppIcon name="arrow-left" size={17} /> Voltar ao evento</Button> : <Button className="button-secondary" onClick={() => navigate(paths.home)}><AppIcon name="compass" size={17} /> Ver eventos</Button>}<Button className="button-secondary" onClick={() => navigate(paths.eventLookup)}><AppIcon name="search" size={17} /> Consultar inscrição</Button><Button className="button-secondary" onClick={() => navigate(destination)}>{destination === paths.login ? "Fazer login" : "Minha conta"}</Button></div></nav>{children}</main>;
}

function PublicEventPage({ publicId }: { publicId: string }) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let mounted = true; apiRequest<{ event: PublicEvent }>(`/api/public/events/${publicId}`).then((result) => mounted && setEvent(result.event)).catch((requestError) => mounted && setError(messageFrom(requestError))); return () => { mounted = false; }; }, [publicId]);
  return <PublicLayout>{error ? <div className="public-error"><h1>Evento não encontrado</h1><p>{error}</p></div> : !event ? <p className="loading-text public-loading">Carregando evento…</p> : <>
    <section className="public-hero">
      <img alt="" className="public-hero-image" src={imageForEvent(event)} />
      <span aria-hidden="true" className="public-hero-overlay" />
      <div><span className="badge badge-glass">Experiência no Vale</span><h1>{event.name}</h1><p>{descriptionForPublicEvent(event)}</p></div>
    </section>
    <section className="public-content">
      <article className="public-info-card public-about-card">
        <span className="catalog-eyebrow"><AppIcon name="sparkles" size={15} /> Conexões que movem o Vale</span>
        <h2>Sobre o evento</h2>
        <p>Participe deste encontro especial, valorize o que é produzido na região e viva uma experiência memorável.</p>
        <div className="info-line"><strong><AppIcon name="calendar" size={18} /> Data</strong><span>{dateFormat.format(new Date(event.date))}</span></div>
        <div className="info-line"><strong><AppIcon name="map-pin" size={18} /> Local</strong><span>{event.location}</span></div>
        <div className="info-line"><strong><AppIcon name="users" size={18} /> Capacidade</strong><span>{event.capacity} participantes</span></div>
        <div className="info-line"><strong><AppIcon name="check-circle" size={18} /> Organização</strong><span>Evento360 · Vale do São Francisco</span></div>
      </article>
      <aside className="public-info-card public-registration">
        <span className={`badge ${event.isFull ? "badge-gold" : "badge-green"}`}>{event.isFull ? "Evento lotado" : `${event.availableSeats} vagas disponíveis`}</span>
        <h2>Garanta sua vaga</h2>
        <p>{event.isFull ? "As vagas acabaram, mas você pode entrar na lista de espera e ser chamado automaticamente se alguém cancelar." : "A inscrição online leva menos de 1 minuto."}</p>
        <Button className="button-primary button-block" onClick={() => navigate(`/event/${event.publicId}/register`)}>{event.isFull ? "Entrar na lista de espera" : "Inscrever-se"} <AppIcon name="arrow-right" size={18} /></Button>
        <small>Evento360 · Vale do São Francisco</small>
      </aside>
    </section>
  </>}</PublicLayout>;
}

function RegistrationPage({ publicId, participant }: { publicId: string; participant: ParticipantAccount | null }) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [name, setName] = useState(participant?.name ?? ""); const [email, setEmail] = useState(participant?.email ?? ""); const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { let mounted = true; apiRequest<{ event: PublicEvent }>(`/api/public/events/${publicId}`).then((result) => mounted && setEvent(result.event)).catch((requestError) => mounted && setError(messageFrom(requestError))); return () => { mounted = false; }; }, [publicId]);
  async function submit(form: FormEvent<HTMLFormElement>) { form.preventDefault(); setLoading(true); setError(null); try { const result = await apiRequest<{ registration: { confirmationCode: string; cancellationToken: string } }>(`/api/public/events/${publicId}/registrations`, { method: "POST", auth: participant ? "participant" : undefined, body: JSON.stringify({ participantName: name, participantEmail: email, participantPhone: phone, joinWaitlist: Boolean(event?.isFull) }) }); navigate(`/registration/${result.registration.confirmationCode}?cancel=${result.registration.cancellationToken}`); } catch (requestError) { if (requestError instanceof ApiError && requestError.code === "EVENT_FULL") { setError("As vagas acabaram enquanto você preenchia o formulário. Você ainda pode entrar na lista de espera."); apiRequest<{ event: PublicEvent }>(`/api/public/events/${publicId}`).then((result) => setEvent(result.event)).catch(() => undefined); } else { setError(messageFrom(requestError)); } } finally { setLoading(false); } }
  return <PublicLayout back={() => navigate(`/event/${publicId}`)}><section className="registration-wrap"><form className="form-card" onSubmit={submit}><span className="badge badge-blue">{event?.name || "Inscrição"}</span><h1>{event?.isFull ? "Entrar na lista de espera" : "Faça sua inscrição"}</h1>{event?.isFull ? <Alert kind="success">O evento está lotado. Você entrará na fila e, se uma vaga abrir, sua inscrição será confirmada automaticamente.</Alert> : null}<p>{participant ? `Você está entrando como ${participant.name}. Seus dados de conta serão usados com segurança.` : "Preencha seus dados. Você não precisa criar uma conta."}</p><Field label="Nome completo"><input disabled={loading || Boolean(participant)} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" required value={name} /></Field><Field label="E-mail"><input disabled={loading || Boolean(participant)} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" required type="email" value={email} /></Field><Field label="WhatsApp para contato"><input autoComplete="tel" disabled={loading} inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="(87) 99999-9999" required type="tel" value={phone} /></Field>{error ? <Alert>{error}</Alert> : null}<Button className="button-primary button-block" disabled={loading} type="submit">{loading ? "Confirmando…" : event?.isFull ? "Entrar na lista de espera" : "Confirmar inscrição"}</Button></form></section></PublicLayout>;
}

function ConfirmationPage({ code }: { code: string }) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null); const [error, setError] = useState<string | null>(null);
  const cancellationToken = useMemo(() => new URLSearchParams(window.location.search).get("cancel"), []);
  useEffect(() => { let mounted = true; apiRequest<{ registration: Confirmation }>(`/api/public/registrations/confirmation/${code}`).then((result) => mounted && setConfirmation(result.registration)).catch((requestError) => mounted && setError(messageFrom(requestError))); return () => { mounted = false; }; }, [code]);
  return <PublicLayout>{error ? <div className="public-error"><h1>Inscrição não encontrada</h1><p>{error}</p><Button className="button-secondary" onClick={() => navigate(paths.eventLookup)}>Tentar outro código</Button></div> : !confirmation ? <p className="loading-text public-loading">Carregando confirmação…</p> : <section className="success-card registration-proof"><div className="success-icon"><AppIcon name="check" size={38} /></div><RegistrationBadge status={confirmation.status} /><h1>{confirmation.status === "WAITLISTED" ? "Você está na lista de espera" : "Comprovante de inscrição"}</h1><p>Cadastro de <strong>{confirmation.participantName}</strong> em <strong>{confirmation.event.name}</strong>.</p><div className="proof-details"><div><small>Data e horário do evento</small><strong>{dateFormat.format(new Date(confirmation.event.date))}</strong></div><div><small>Local</small><strong>{confirmation.event.location}</strong></div><div><small>Inscrição realizada em</small><strong>{dateFormat.format(new Date(confirmation.createdAt))}</strong></div>{confirmation.checkedInAt ? <div><small>Check-in realizado em</small><strong>{dateFormat.format(new Date(confirmation.checkedInAt))}</strong></div> : null}</div>{confirmation.status === "WAITLISTED" && confirmation.waitlistPosition ? <div className="code-box"><small>Sua posição na fila</small><strong>{confirmation.waitlistPosition}º</strong></div> : null}<div className="code-box"><small>Código da inscrição</small><strong>{confirmation.confirmationCode}</strong></div><p className="small-text">{confirmation.status === "WAITLISTED" ? "Se uma vaga abrir, sua inscrição será confirmada automaticamente e você receberá o ingresso por e-mail." : "Este código comprova o cadastro e poderá ser utilizado no check-in."}</p><div className="button-row centered"><Button className="button-secondary" onClick={() => navigator.clipboard?.writeText(confirmation.confirmationCode)}>Copiar código</Button><Button className="button-secondary" onClick={() => window.print()}>Imprimir comprovante</Button><Button className="button-primary" onClick={() => navigate(`/event/${confirmation.event.publicId}`)}>Ver evento</Button></div>{cancellationToken && confirmation.status !== "CANCELLED" ? <button className="cancel-link" onClick={() => navigate(`/registration/cancel/${cancellationToken}`)} type="button">{confirmation.status === "WAITLISTED" ? "Sair da lista de espera" : "Cancelar inscrição"}</button> : null}</section>}</PublicLayout>;
}

function CancellationPage({ token }: { token: string }) {
  const [registration, setRegistration] = useState<CancellableRegistration | null>(null); const [error, setError] = useState<string | null>(null); const [confirming, setConfirming] = useState(false); const [loading, setLoading] = useState(false);
  useEffect(() => { let mounted = true; apiRequest<{ registration: CancellableRegistration }>(`/api/public/registrations/cancel/${token}`).then((result) => mounted && setRegistration(result.registration)).catch((requestError) => mounted && setError(messageFrom(requestError))); return () => { mounted = false; }; }, [token]);
  async function cancel() { setLoading(true); try { const result = await apiRequest<{ registration: CancellableRegistration }>(`/api/public/registrations/cancel/${token}`, { method: "POST" }); setRegistration(result.registration); } catch (requestError) { setError(messageFrom(requestError)); } finally { setLoading(false); } }
  return <PublicLayout>{error ? <div className="public-error"><h1>Não foi possível cancelar</h1><p>{error}</p></div> : !registration ? <p className="loading-text public-loading">Carregando inscrição…</p> : <section className="success-card"><span className="badge badge-blue">Evento360</span><h1>Cancelar inscrição</h1><p>{registration.participantName}, sua inscrição em <strong>{registration.event.name}</strong> está {registration.status === "ACTIVE" ? "ativa" : registration.status === "WAITLISTED" ? "na lista de espera" : "cancelada"}.</p>{registration.status === "CANCELLED" ? <Alert kind="success">Esta inscrição já foi cancelada.</Alert> : !confirming ? <Button className="button-danger" onClick={() => setConfirming(true)}>{registration.status === "WAITLISTED" ? "Sair da lista de espera" : "Cancelar minha inscrição"}</Button> : <div className="confirmation-box"><strong>Tem certeza?</strong><p>{registration.status === "WAITLISTED" ? "Você perderá sua posição na fila." : "Esta ação libera sua vaga."}</p><div className="button-row centered"><Button className="button-danger" disabled={loading} onClick={cancel}>{loading ? "Cancelando…" : "Confirmar cancelamento"}</Button><Button className="button-secondary" disabled={loading} onClick={() => setConfirming(false)}>Voltar</Button></div></div>}</section>}</PublicLayout>;
}

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [organizer, setOrganizer] = useState<Organizer | null>(null);
  const [participant, setParticipant] = useState<ParticipantAccount | null>(null);
  const [checkingSession, setCheckingSession] = useState(
    Boolean(getAccessToken("organizer") || getAccessToken("participant")),
  );
  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  useEffect(() => {
    let mounted = true;
    const restoreOrganizer = getAccessToken("organizer")
      ? apiRequest<{ organizer: Organizer }>("/api/admin/auth/me", { auth: "organizer" })
          .then((result) => { if (mounted) setOrganizer(result.organizer); })
          .catch(() => { clearAccessToken("organizer"); if (mounted) setOrganizer(null); })
      : Promise.resolve();
    const restoreParticipant = getAccessToken("participant")
      ? apiRequest<{ participant: ParticipantAccount }>("/api/public/auth/me", { auth: "participant" })
          .then((result) => { if (mounted) setParticipant(result.participant); })
          .catch(() => { clearAccessToken("participant"); if (mounted) setParticipant(null); })
      : Promise.resolve();
    Promise.all([restoreOrganizer, restoreParticipant]).finally(() => {
      if (mounted) setCheckingSession(false);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const expired = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: "organizer" | "participant" }>).detail?.scope;
      if (scope === "organizer") {
        clearAccessToken("organizer");
        setOrganizer(null);
        if (matchRoute(window.location.pathname).access === "ORGANIZER") {
          navigate(paths.organizerLogin, { replace: true });
        }
      }
      if (scope === "participant") {
        clearAccessToken("participant");
        setParticipant(null);
        if (matchRoute(window.location.pathname).access === "PARTICIPANT") {
          navigate(paths.participantLogin, { replace: true });
        }
      }
    };
    window.addEventListener(sessionExpiredEvent, expired);
    return () => window.removeEventListener(sessionExpiredEvent, expired);
  }, []);

  const logoutOrganizer = useCallback(async () => {
    try { await apiRequest<void>("/api/admin/auth/logout", { method: "POST", auth: "organizer" }); } catch { /* a sessão local ainda deve ser encerrada */ }
    clearAccessToken("organizer"); setOrganizer(null); navigate(paths.home);
  }, []);
  const logoutParticipant = useCallback(async () => {
    try { await apiRequest<void>("/api/public/auth/logout", { method: "POST", auth: "participant" }); } catch { /* a sessão local ainda deve ser encerrada */ }
    clearAccessToken("participant"); setParticipant(null); navigate(paths.home);
  }, []);

  if (checkingSession) return <main className="session-loading">Carregando Evento360…</main>;
  const route = matchRoute(path);
  const activeRoles: UserRole[] = [
    ...(organizer ? ["ORGANIZER" as const] : []),
    ...(participant ? ["PARTICIPANT" as const] : []),
  ];
  const decision = accessDecision(route, activeRoles);
  if (decision === "unauthenticated") {
    return <Redirect to={route.access === "ORGANIZER" ? paths.organizerLogin : paths.participantLogin} />;
  }
  if (decision === "forbidden") return <ForbiddenPage />;

  if (route.id === "home") return <Evento360Publico accountPath={accountDestination()} hasAccount={Boolean(organizer || participant)} onNavigate={navigate} />;
  if (route.id === "role-selection") return <RoleSelectionPage organizer={organizer} participant={participant} />;
  if (route.id === "organizer-login") return organizer ? <Redirect to={paths.adminEvents} /> : <LoginPage onLoggedIn={(account) => setOrganizer(account as Organizer)} profile="organizer" />;
  if (route.id === "participant-login") return participant ? <Redirect to={paths.participantEvents} /> : <LoginPage onLoggedIn={(account) => setParticipant(account as ParticipantAccount)} profile="participant" />;
  if (route.id === "signup") return <SignUpPage onLoggedIn={setParticipant} />;
  if (route.id === "forgot-password") return <ForgotPasswordPage profile={route.params.profile as AccountProfile} />;
  if (route.id === "reset-password") return <ResetPasswordPage profile={route.params.profile as AccountProfile} token={route.params.token} />;
  if (route.id === "event-lookup") return <EventLookupPage />;
  if (route.id === "event-registration") return <RegistrationPage participant={participant} publicId={route.params.publicId} />;
  if (route.id === "public-event") return <PublicEventPage publicId={route.params.publicId} />;
  if (route.id === "registration-cancellation") return <CancellationPage token={route.params.token} />;
  if (route.id === "registration-confirmation") return <ConfirmationPage code={route.params.code} />;
  if (route.id === "participant-events" && participant) return <ParticipantEventsPage onLogout={logoutParticipant} user={participant} />;
  if (route.id === "admin-events" && organizer) return <EventListPage onLogout={logoutOrganizer} organizer={organizer} />;
  if (route.id === "admin-participants" && organizer) return <AdminEventSelectorPage mode="participants" onLogout={logoutOrganizer} organizer={organizer} />;
  if (route.id === "admin-checkin" && organizer) return <AdminEventSelectorPage mode="checkin" onLogout={logoutOrganizer} organizer={organizer} />;
  if (route.id === "admin-event-new" && organizer) return <NewEventPage onLogout={logoutOrganizer} organizer={organizer} />;
  if (route.id === "admin-event-edit" && organizer) return <EditEventPage eventId={route.params.eventId} onLogout={logoutOrganizer} organizer={organizer} />;
  if (route.id === "admin-event-participants" && organizer) return <ParticipantsPage eventId={route.params.eventId} onLogout={logoutOrganizer} organizer={organizer} />;
  if (route.id === "admin-event-checkin" && organizer) return <CheckInPage eventId={route.params.eventId} onLogout={logoutOrganizer} organizer={organizer} />;
  if (route.id === "admin-event" && organizer) return <EventManagementPage eventId={route.params.eventId} onLogout={logoutOrganizer} organizer={organizer} />;
  return <NotFoundPage />;
}
