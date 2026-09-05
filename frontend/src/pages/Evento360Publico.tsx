import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest } from "../services/api";
import { AppIcon } from "../components/AppIcon";
import { BrandLogo } from "../components/BrandLogo";

export type PublicCatalogEvent = {
  publicId: string;
  name: string;
  date: string;
  location: string;
  capacity: number;
  availableSeats: number;
  isFull: boolean;
};

type Evento360PublicoProps = {
  accountPath?: string;
  hasAccount?: boolean;
  onNavigate: (path: string) => void;
};

const categories = ["Todos", "Tecnologia", "Cultura", "Gastronomia", "Educação", "Esportes", "Negócios"] as const;

const categoryKeywords: Array<[string, string[]]> = [
  ["Tecnologia", ["tech", "tecnologia", "digital", "inovação", "startup", "conecta"]],
  ["Gastronomia", ["sabor", "gastro", "vinho", "comida", "culinária"]],
  ["Cultura", ["cultura", "música", "som", "arte", "criativa", "festival"]],
  ["Negócios", ["negócio", "empreende", "network", "empresa"]],
  ["Educação", ["educação", "jornada", "curso", "workshop", "palestra"]],
  ["Esportes", ["corrida", "esporte", "fitness", "pedal"]],
];

const eventImages = ["/assets/evento-tech.png", "/assets/evento-gastro.png", "/assets/evento-cultura.png"];

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function categoryForEvent(event: Pick<PublicCatalogEvent, "name">) {
  const name = normalized(event.name);
  return categoryKeywords.find(([, keywords]) => keywords.some((keyword) => name.includes(normalized(keyword))))?.[0] ?? "Experiências";
}

export function imageForEvent(event: Pick<PublicCatalogEvent, "name">, index = 0) {
  const category = categoryForEvent(event);
  if (category === "Gastronomia") return eventImages[1];
  if (category === "Cultura") return eventImages[2];
  return eventImages[index % eventImages.length];
}

export function descriptionForPublicEvent(event: Pick<PublicCatalogEvent, "name">) {
  const category = categoryForEvent(event);
  if (category === "Gastronomia") return "Sabores, cultura e encontros que contam histórias do Vale do São Francisco.";
  if (category === "Cultura") return "Arte, música e experiências criadas por gente que movimenta a região.";
  if (category === "Tecnologia" || category === "Negócios") return "Ideias, inovação e conexões para transformar o futuro do semiárido brasileiro.";
  return "Uma experiência para conectar pessoas, ideias e novas possibilidades na região.";
}

function messageFrom(error: unknown) {
  return error instanceof ApiError ? error.message : "Não foi possível carregar os eventos agora.";
}

function eventDateParts(value: string) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "").toUpperCase(),
    time: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date),
    full: new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(date),
  };
}

export function Evento360Publico({ accountPath = "/login", hasAccount = false, onNavigate }: Evento360PublicoProps) {
  const [events, setEvents] = useState<PublicCatalogEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("Todos");

  useEffect(() => {
    let mounted = true;
    apiRequest<{ events: PublicCatalogEvent[] }>("/api/public/events")
      .then((result) => mounted && setEvents(result.events))
      .catch((requestError) => mounted && setError(messageFrom(requestError)))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const filteredEvents = useMemo(() => {
    const term = normalized(query.trim());
    return events.filter((event) => {
      const matchesCategory = activeCategory === "Todos" || categoryForEvent(event) === activeCategory;
      const matchesQuery = !term || normalized(`${event.name} ${event.location} ${categoryForEvent(event)}`).includes(term);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, events, query]);

  const featured = events[0];

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    document.querySelector("#eventos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-header-inner">
          <BrandLogo onClick={() => onNavigate("/")} />
          <nav aria-label="Navegação pública" className="catalog-nav-links">
            <a href="#eventos">Explorar</a>
            <a href="#categorias">Categorias</a>
            <a href="/find-registration" onClick={(event) => { event.preventDefault(); onNavigate("/find-registration"); }}>Consultar inscrição</a>
            <a href="#organizadores">Para organizadores</a>
          </nav>
          <div className="catalog-header-actions">
            <span className="catalog-location"><AppIcon name="map-pin" size={15} /> Petrolina e região</span>
            <button className="button button-secondary" onClick={() => onNavigate(accountPath)} type="button">{hasAccount ? "Acessar minha conta" : "Fazer login"}</button>
          </div>
        </div>
      </header>

      <section className="catalog-hero">
        <div aria-hidden="true" className="river-lines"><i /><i /><i /></div>
        <div className="catalog-hero-inner">
          <div className="catalog-hero-copy">
            <span className="catalog-eyebrow catalog-eyebrow-light"><AppIcon name="sparkles" size={15} /> Feito para o Vale do São Francisco</span>
            <h1>O Vale acontece <em>aqui.</em></h1>
            <p>Descubra o que fazer, encontre sua turma e garanta sua vaga sem complicação.</p>
            <form className="catalog-search" onSubmit={submitSearch}>
              <AppIcon className="catalog-search-icon" name="search" size={21} />
              <input aria-label="Buscar eventos" onChange={(event) => setQuery(event.target.value)} placeholder="Busque por evento, tema ou lugar" value={query} />
              {query ? <button aria-label="Limpar busca" className="catalog-clear" onClick={() => setQuery("")} type="button">×</button> : null}
              <button className="catalog-search-button" type="submit">Buscar eventos</button>
            </form>
            <div className="catalog-proof">
              <span><AppIcon name="check-circle" size={15} /> Eventos locais selecionados</span>
              <span><AppIcon name="check-circle" size={15} /> Inscrição em poucos passos</span>
              <span><AppIcon name="ticket" size={15} /> Ingresso direto no celular</span>
            </div>
          </div>

          {featured ? (
            <button className="catalog-spotlight" onClick={() => onNavigate(`/event/${featured.publicId}`)} type="button">
              <img alt="" src={imageForEvent(featured)} />
              <span className="catalog-spotlight-copy">
                <span className="catalog-eyebrow catalog-eyebrow-light">Destaque da semana</span>
                <strong>{featured.name}</strong>
                <small>{eventDateParts(featured.date).full}</small>
                <b>Ver evento <AppIcon name="arrow-right" size={16} /></b>
              </span>
            </button>
          ) : (
            <aside className="catalog-spotlight catalog-spotlight-empty">
              <img alt="Paisagem do Vale do São Francisco" src="/assets/evento-tech.png" />
              <span className="catalog-spotlight-copy">
                <span className="catalog-eyebrow catalog-eyebrow-light">Conexões que movem o Vale</span>
                <strong>Novas experiências em breve</strong>
                <small>Acompanhe a agenda do Evento360.</small>
              </span>
            </aside>
          )}
        </div>
      </section>

      <section className="catalog-section catalog-categories" id="categorias">
        <header className="catalog-section-heading">
          <div><span className="catalog-eyebrow">Explore do seu jeito</span><h2>Qual é a sua vibe hoje?</h2></div>
          <p>{loading ? "Carregando a agenda…" : `${events.length} ${events.length === 1 ? "evento próximo" : "eventos próximos"}`}</p>
        </header>
        <div className="category-list">
          {categories.map((category) => (
            <button className={activeCategory === category ? "active" : ""} key={category} onClick={() => setActiveCategory(category)} type="button">
              <span className="category-icon"><AppIcon name={category === "Todos" ? "compass" : category === "Esportes" ? "checkin" : category === "Gastronomia" ? "sparkles" : category === "Cultura" ? "ticket" : category === "Tecnologia" ? "check-circle" : category === "Educação" ? "calendar" : "users"} size={22} /></span>
              <strong>{category}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="catalog-section catalog-events" id="eventos">
        <header className="catalog-section-heading">
          <div><span className="catalog-eyebrow">Agenda Evento360</span><h2>{activeCategory === "Todos" ? "Eventos que valem sair de casa" : `Eventos de ${activeCategory}`}</h2></div>
          <span className="catalog-count">{filteredEvents.length} {filteredEvents.length === 1 ? "evento" : "eventos"}</span>
        </header>

        {loading ? <div className="catalog-state"><span className="catalog-spinner" />Carregando experiências do Vale…</div> : null}
        {error ? <div className="catalog-state catalog-state-error"><strong>Não foi possível carregar a agenda.</strong><span>{error}</span></div> : null}
        {!loading && !error && filteredEvents.length === 0 ? (
          <div className="catalog-state">
            <AppIcon name="search" size={28} />
            <strong>Nenhum evento encontrado</strong>
            <span>Tente outra busca ou veja todas as categorias.</span>
            <button className="button button-secondary" onClick={() => { setQuery(""); setActiveCategory("Todos"); }} type="button">Limpar filtros</button>
          </div>
        ) : null}

        <div className="catalog-event-grid">
          {filteredEvents.map((event, index) => {
            const date = eventDateParts(event.date);
            const category = categoryForEvent(event);
            return (
              <article className="catalog-event-card" key={event.publicId}>
                <button className="catalog-event-cover" onClick={() => onNavigate(`/event/${event.publicId}`)} type="button">
                  <img alt="" src={imageForEvent(event, index)} />
                  <span className="catalog-cover-shade" />
                  <span className="catalog-card-badge">{category}</span>
                  {event.isFull ? <span className="catalog-card-tag">Evento lotado</span> : event.availableSeats <= Math.max(10, Math.round(event.capacity * .15)) ? <span className="catalog-card-tag"><AppIcon name="sparkles" size={13} /> Últimas vagas</span> : null}
                </button>
                <button className="catalog-event-body" onClick={() => onNavigate(`/event/${event.publicId}`)} type="button">
                  <span className="catalog-date"><b>{date.day}</b><small>{date.month}</small></span>
                  <span className="catalog-event-info">
                    <strong>{event.name}</strong>
                    <span><AppIcon name="map-pin" size={15} /> {event.location}</span>
                    <span><AppIcon name="clock" size={15} /> {date.time} · Vale do São Francisco</span>
                    <span className="catalog-event-meta"><b>Inscrição online</b><small>{event.isFull ? "Lotado" : `${event.availableSeats} vagas`}</small></span>
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="catalog-organizer-cta" id="organizadores">
        <div>
          <span className="catalog-eyebrow catalog-eyebrow-light">Evento bom merece casa cheia</span>
          <h2>Você organiza. O Evento360 aproxima.</h2>
          <p>Publique sua página, controle vagas e acompanhe inscrições em um só lugar.</p>
        </div>
        <button className="catalog-cta-button" onClick={() => onNavigate("/login/organizer")} type="button">Acessar como organizador <AppIcon name="arrow-right" size={18} /></button>
      </section>

      <footer className="catalog-footer">
        <BrandLogo onClick={() => onNavigate("/")} />
        <p>Conexões que movem o Vale.</p>
        <small>Evento360 · Vale do São Francisco</small>
      </footer>
    </main>
  );
}
