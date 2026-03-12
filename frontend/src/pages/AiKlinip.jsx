import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveHealthProfile,
  getAiHistory,
  getAppointments,
  getDocuments,
  getMedications,
  sendAiChat,
} from "../api";
import { parseDate } from "../utils/dates";

const QUICK_ACTIONS = [
  { id: "document", prompt: "Explicame mi ultimo documento", title: "Ultimo documento", subtitle: "Analizar y explicar", token: "DOC" },
  { id: "meds", prompt: "Que medicamentos estoy tomando?", title: "Mis medicamentos", subtitle: "Ver plan activo", token: "MED" },
  { id: "next", prompt: "Cuando es mi proxima cita?", title: "Proxima cita", subtitle: "Fecha y detalles", token: "CIT" },
  { id: "timeline", prompt: "Resume mi historial clinico", title: "Historial clinico", subtitle: "Resumen general", token: "HIS" },
];

const DOC_LABELS = { receta: "Receta", orden: "Orden", resultado: "Resultado", informe: "Informe", otro: "Documento" };
const APPOINTMENT_TYPE_LABELS = { cita: "Cita", examen: "Examen", tramite: "Tramite" };

const INITIAL_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content: "Puedo ayudarte a revisar documentos, OCR, medicamentos, citas e historial usando el perfil activo de Klinip.",
  references: [],
  createdAt: null,
};

function cleanAssistantText(value) {
  return String(value || "").replace(/\*\*/g, "").replace(/__/g, "").trim();
}

function formatMessageTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Ahora";
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function formatShortDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" }).format(parsed);
}

function formatDateTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function daysUntil(value) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return Math.ceil((parsed.getTime() - Date.now()) / 86400000);
}

function sourceCount(sources, key) {
  return Number((sources || []).find((item) => item.key === key)?.count || 0);
}

function sourceLabel(sources, key, fallback) {
  return (sources || []).find((item) => item.key === key)?.label || fallback;
}

function getUpcomingAppointments(items) {
  const now = Date.now();
  const validItems = [...(items || [])]
    .filter((item) => {
      const date = parseDate(item.date_time);
      return date && item.status !== "realizada";
    })
    .sort((a, b) => parseDate(a.date_time) - parseDate(b.date_time));

  const futureItems = validItems.filter((item) => parseDate(item.date_time).getTime() >= now);
  if (futureItems.length) return futureItems;

  return validItems
    .slice()
    .sort((a, b) => Math.abs(parseDate(a.date_time).getTime() - now) - Math.abs(parseDate(b.date_time).getTime() - now));
}

function getRecentDocuments(items) {
  return [...(items || [])].sort((a, b) => {
    const left = parseDate(a.date || a.created_at)?.getTime() || 0;
    const right = parseDate(b.date || b.created_at)?.getTime() || 0;
    return right - left;
  });
}

function getActiveMedications(items) {
  return [...(items || [])].filter((item) => !item.completed);
}

function Ring({ value }) {
  const safeValue = Math.max(0, Math.min(100, value));
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * safeValue) / 100;

  return (
    <div className="ai-score-ring">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="ai-score-ring-track" cx="32" cy="32" r={radius} />
        <circle
          className="ai-score-ring-fill"
          cx="32"
          cy="32"
          r={radius}
          style={{ strokeDasharray: circumference, strokeDashoffset: dashOffset }}
        />
      </svg>
      <div className="ai-score-ring-inner">
        <strong>{safeValue}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

export default function AiKlinip() {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [rightTab, setRightTab] = useState("today");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [scanVisible, setScanVisible] = useState(false);
  const [resources, setResources] = useState({ profile: null, appointments: [], documents: [], medications: [] });
  const [meta, setMeta] = useState({
    disclaimer: "Klinip IA entrega informacion orientativa y no reemplaza la evaluacion de un profesional de salud.",
    model: "context-fallback",
    mode: "fallback",
    activeProfileName: "",
    sources: [],
  });
  const scrollRef = useRef(null);
  const fileTimerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const loadResources = async () => {
      const [profile, appointments, documents, medications] = await Promise.all([
        getActiveHealthProfile().catch(() => null),
        getAppointments().catch(() => []),
        getDocuments().catch(() => []),
        getMedications().catch(() => []),
      ]);
      if (!mounted) return;

      setResources({
        profile,
        appointments: Array.isArray(appointments) ? appointments : [],
        documents: Array.isArray(documents) ? documents : [],
        medications: Array.isArray(medications) ? medications : [],
      });

      if (profile?.full_name) {
        setMeta((prev) => ({ ...prev, activeProfileName: profile.full_name }));
      }
    };

    const loadAll = async () => {
      setHistoryLoading(true);
      try {
        const historyItems = await getAiHistory().catch(() => []);
        if (!mounted) return;

        if (Array.isArray(historyItems) && historyItems.length) {
          setMessages(
            historyItems.map((item) => ({
              id: item.id,
              role: item.role === "user" ? "user" : "assistant",
              content: item.content,
              references: Array.isArray(item?.metadata_json?.references) ? item.metadata_json.references : [],
              createdAt: item.created_at || null,
            }))
          );
        } else {
          setMessages([INITIAL_MESSAGE]);
        }

        await loadResources();
      } catch (error) {
        if (!mounted) return;
        console.error("No se pudo cargar Klinip IA", error);
        setMessages([INITIAL_MESSAGE]);
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    };

    const handleWindowSync = () => {
      loadResources().catch((error) => {
        console.error("No se pudieron refrescar recursos IA", error);
      });
    };

    loadAll();
    window.addEventListener("focus", handleWindowSync);
    document.addEventListener("visibilitychange", handleWindowSync);

    return () => {
      mounted = false;
      window.removeEventListener("focus", handleWindowSync);
      document.removeEventListener("visibilitychange", handleWindowSync);
      if (fileTimerRef.current) clearTimeout(fileTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, historyLoading]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 980) {
        setMobilePanelOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const upcomingAppointments = useMemo(() => getUpcomingAppointments(resources.appointments), [resources.appointments]);
  const nextAppointment = upcomingAppointments[0] || null;
  const recentDocuments = useMemo(() => getRecentDocuments(resources.documents).slice(0, 4), [resources.documents]);
  const activeMedications = useMemo(() => getActiveMedications(resources.medications), [resources.medications]);

  const inferredSources = useMemo(() => {
    if (Array.isArray(meta.sources) && meta.sources.length) return meta.sources;
    return [
      { key: "documents", label: "Documentos", count: resources.documents.length, enabled: true },
      { key: "medications", label: "Medicamentos", count: resources.medications.length, enabled: true },
      { key: "appointments", label: "Citas y actividades", count: resources.appointments.length, enabled: true },
      {
        key: "timeline",
        label: "Historial clinico",
        count: resources.appointments.length + resources.documents.length + resources.medications.length,
        enabled: true,
      },
      {
        key: "reminders",
        label: "Recordatorios",
        count: upcomingAppointments.length + activeMedications.length,
        enabled: true,
      },
    ];
  }, [meta.sources, resources.documents.length, resources.medications.length, resources.appointments.length, upcomingAppointments.length, activeMedications.length]);

  const contextTags = useMemo(
    () => [
      { key: "documents", label: `${sourceCount(inferredSources, "documents")} ${sourceLabel(inferredSources, "documents", "Documentos").toLowerCase()}`, tone: "blue" },
      { key: "medications", label: `${sourceCount(inferredSources, "medications")} ${sourceLabel(inferredSources, "medications", "Medicamentos").toLowerCase()}`, tone: "teal" },
      { key: "appointments", label: `${sourceCount(inferredSources, "appointments")} citas proximas`, tone: "violet" },
      { key: "timeline", label: `${sourceCount(inferredSources, "timeline")} registros clinicos`, tone: "amber" },
    ],
    [inferredSources]
  );

  const scoreData = useMemo(() => {
    const medicationScore = activeMedications.length ? 100 : 35;
    const documentScore = Math.min(100, resources.documents.length * 20);
    const appointmentScore = nextAppointment ? 100 : 25;
    return {
      medicationScore,
      documentScore,
      appointmentScore,
      total: Math.round((medicationScore + documentScore + appointmentScore) / 3),
    };
  }, [activeMedications.length, resources.documents.length, nextAppointment]);

  const hasConversation = useMemo(() => messages.some((message) => String(message.id) !== "welcome"), [messages]);

  const submitPrompt = async (promptValue) => {
    const prompt = (promptValue || "").trim();
    if (!prompt || loading) return;

    const attachmentName = attachedFile?.name || "";
    const finalPrompt = attachmentName ? `${prompt}\n\nReferencia local preparada: ${attachmentName}.` : prompt;

    const userMessageId = `user-${Date.now()}`;
    const nextUserMessage = {
      id: userMessageId,
      role: "user",
      content: prompt,
      references: [],
      createdAt: new Date().toISOString(),
      attachmentName,
    };

    const historyForApi = messages
      .filter((item) => item.role === "user" || item.role === "assistant")
      .map((item) => ({ role: item.role, content: item.content }));

    setMessages((prev) => [...prev, nextUserMessage]);
    setInput("");
    setAttachedFile(null);
    setScanVisible(false);
    setLoading(true);

    try {
      const response = await sendAiChat({ message: finalPrompt, history: historyForApi });
      setMeta((prev) => ({
        disclaimer: response?.disclaimer || prev.disclaimer,
        model: response?.model || "context-fallback",
        mode: response?.mode || "fallback",
        activeProfileName: response?.active_profile_name || prev.activeProfileName || resources.profile?.full_name || "",
        sources: Array.isArray(response?.sources) ? response.sources : prev.sources,
      }));
      setMessages((prev) => [
        ...prev.map((item) => (
          item.id === userMessageId && response?.user_message_created_at
            ? { ...item, createdAt: response.user_message_created_at }
            : item
        )),
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: cleanAssistantText(response?.reply || "No pude generar una respuesta en este momento. Intenta reformular tu consulta."),
          references: Array.isArray(response?.references) ? response.references : [],
          createdAt: response?.assistant_message_created_at || new Date().toISOString(),
        },
      ]);
      const [profile, appointments, documents, medications] = await Promise.all([
        getActiveHealthProfile().catch(() => null),
        getAppointments().catch(() => []),
        getDocuments().catch(() => []),
        getMedications().catch(() => []),
      ]);
      setResources({
        profile,
        appointments: Array.isArray(appointments) ? appointments : [],
        documents: Array.isArray(documents) ? documents : [],
        medications: Array.isArray(medications) ? medications : [],
      });
    } catch (error) {
      console.error("No se pudo consultar Klinip IA", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: "No pude consultar Klinip IA en este momento. Revisa tu conexion o intenta nuevamente.",
          references: [],
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setAttachedFile(selected);
    setScanVisible(true);
    if (fileTimerRef.current) clearTimeout(fileTimerRef.current);
    fileTimerRef.current = setTimeout(() => setScanVisible(false), 2800);
  };

  const nextAppointmentPrompt = nextAppointment
    ? `Prepara un resumen para mi cita de ${formatDateTime(nextAppointment.date_time)}`
    : "Cuando es mi proxima cita?";
  const medsAlertPrompt = activeMedications.length > 1
    ? "Revisa si tengo interacciones entre mis medicamentos actuales"
    : "Resume mis medicamentos activos";

  return (
    <div className="ai-page ai-copilot-page">
      <section className="ai-copilot-shell">
        <div className="ai-copilot-main">
          <div className="ai-copilot-stage">
            <div className="ai-mobile-topbar">
              <div className="ai-mobile-topbar-copy">
                <span>IA Klinip</span>
                <strong>{meta.activeProfileName || resources.profile?.full_name || "Perfil activo"}</strong>
              </div>
              <button
                type="button"
                className="ai-mobile-panel-btn"
                onClick={() => setMobilePanelOpen(true)}
                aria-label="Abrir contexto actual"
              >
                <svg fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24">
                  <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            {!hasConversation ? (
              <div className="ai-landing">
                <div className="ai-landing-center">
                  <div className="ai-landing-icon" aria-hidden="true">KI</div>
                  <h2 className="ai-landing-title">En que te ayudo hoy?</h2>
                  <p className="ai-landing-subtitle">
                    Consulta sobre tus medicamentos, documentos, citas o historial. Soy tu copiloto de salud.
                  </p>
                  <div className="ai-landing-safe">
                    <span className="ai-safe-dot" />
                    <span>{meta.disclaimer}</span>
                  </div>
                </div>

                <div className="ai-context-strip">
                  {contextTags.map((tag) => (
                    <button key={tag.key} type="button" className={`ai-context-tag tone-${tag.tone}`} onClick={() => submitPrompt(`Resume mi ${tag.label}`)}>
                      <span className="ai-context-dot" />
                      <span>{tag.label}</span>
                    </button>
                  ))}
                </div>

                <section className="ai-quick-section">
                  <p className="ai-section-kicker">Acciones rapidas</p>
                  <div className="ai-quick-grid">
                    {QUICK_ACTIONS.map((item) => (
                      <button key={item.id} type="button" className="ai-quick-card" onClick={() => submitPrompt(item.prompt)}>
                        <span className="ai-quick-icon">{item.token}</span>
                        <span className="ai-quick-copy">
                          <strong>{item.title}</strong>
                          <small>{item.subtitle}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="ai-info-row">
                  <button type="button" className="ai-info-card" onClick={() => submitPrompt(nextAppointmentPrompt)}>
                    <span className="ai-info-label tone-violet">Proxima cita</span>
                    <strong>{nextAppointment ? nextAppointment.specialty || "Atencion agendada" : "Sin cita proxima"}</strong>
                    <small>{nextAppointment ? formatDateTime(nextAppointment.date_time) : "Puedo ayudarte a revisar tu agenda clinica."}</small>
                    <em>
                      {nextAppointment && daysUntil(nextAppointment.date_time) !== null
                        ? `En ${Math.max(daysUntil(nextAppointment.date_time), 0)} dias`
                        : "Preparar con IA"}
                    </em>
                  </button>

                  <button type="button" className="ai-info-card" onClick={() => submitPrompt(medsAlertPrompt)}>
                    <span className="ai-info-label tone-amber">Revision sugerida</span>
                    <strong>{activeMedications.length > 1 ? "Interacciones y adherencia" : "Plan de medicamentos"}</strong>
                    <small>
                      {activeMedications.length > 1
                        ? `${activeMedications.length} medicamentos activos para revisar`
                        : "Puedo resumir tu tratamiento actual"}
                    </small>
                    <em>{activeMedications.length > 1 ? "Ver con IA" : "Generar resumen"}</em>
                  </button>
                </section>
              </div>
            ) : (
              <div className="ai-chat" ref={scrollRef}>
                <div className="ai-chat-inner">
                  {messages.map((message) => (
                    <article key={message.id} className={`ai-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
                      <div className={`ai-message-avatar ${message.role === "user" ? "is-user" : "is-ai"}`}>{message.role === "user" ? "TU" : "KI"}</div>
                      <div className="ai-message-column">
                        <div className={`ai-message-bubble ${message.role === "user" ? "is-user" : "is-ai"}`}>
                          <p>{message.role === "assistant" ? cleanAssistantText(message.content) : message.content}</p>
                          {message.attachmentName ? <div className="ai-inline-attachment">{message.attachmentName}</div> : null}
                          {message.role === "assistant" && Array.isArray(message.references) && message.references.length > 0 ? (
                            <div className="ai-reference-list">
                              {message.references.map((reference, index) => (
                                <div key={`${message.id}-${reference.kind}-${index}`} className="ai-reference-chip">
                                  <strong>{reference.label}</strong>
                                  {reference.detail ? <span>{reference.detail}</span> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="ai-message-time">
                          {message.role === "user" ? "Tu" : "Klinip IA"} · {formatMessageTime(message.createdAt)}
                        </div>
                      </div>
                    </article>
                  ))}

                  {(loading || historyLoading) ? (
                    <article className="ai-message is-assistant">
                      <div className="ai-message-avatar is-ai">KI</div>
                      <div className="ai-message-column">
                        <div className="ai-message-bubble is-ai is-loading">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    </article>
                  ) : null}
                </div>
              </div>
            )}

            <div className="ai-input-zone">
              <form className="ai-input-shell" onSubmit={(event) => { event.preventDefault(); submitPrompt(input); }}>
                {(attachedFile || scanVisible) ? (
                  <div className={`ai-upload-strip ${attachedFile ? "has-file" : ""}`}>
                    {attachedFile ? (
                      <div className="ai-upload-chip">
                        <span>DOC</span>
                        <strong>{attachedFile.name}</strong>
                        <button type="button" onClick={() => setAttachedFile(null)}>x</button>
                      </div>
                    ) : null}
                    {scanVisible ? (
                      <div className="ai-scan-badge">
                        <span className="ai-scan-dot" />
                        <span>Preparando contexto local</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="ai-input-row">
                  <textarea
                    className="ai-input-field"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Escribe una pregunta o prepara un documento para consultar..."
                    rows={1}
                    onInput={(event) => {
                      const target = event.currentTarget;
                      target.style.height = "auto";
                      target.style.height = `${Math.min(target.scrollHeight, 92)}px`;
                    }}
                  />

                  <div className="ai-input-actions">
                    <label className="ai-icon-btn" title="Preparar documento">
                      <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" strokeLinecap="round" /></svg>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} />
                    </label>
                    <button type="button" className="ai-icon-btn is-disabled" title="Nota de voz disponible pronto">
                      <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" strokeLinecap="round" /></svg>
                    </button>
                    <button className="ai-send-btn" type="submit" disabled={loading || !input.trim()}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                </div>
              </form>

              <div className="ai-input-footer">
                <span className="ai-safe-dot" />
                <span>La respuesta usa documentos, medicamentos, citas e historial segun permisos del plan.</span>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`ai-mobile-panel-backdrop ${mobilePanelOpen ? "is-visible" : ""}`}
          aria-label="Cerrar contexto actual"
          onClick={() => setMobilePanelOpen(false)}
        />

        <aside className={`ai-right-panel ${mobilePanelOpen ? "is-mobile-open" : ""}`}>
          <div className="ai-right-profile">
            <div className="ai-right-avatar">{(meta.activeProfileName || resources.profile?.full_name || "KP").slice(0, 2).toUpperCase()}</div>
            <div className="ai-right-profile-copy">
              <strong>{meta.activeProfileName || resources.profile?.full_name || "Perfil activo"}</strong>
              <span>Contexto actual de Klinip IA</span>
            </div>
            <button
              type="button"
              className="ai-right-close"
              aria-label="Cerrar contexto actual"
              onClick={() => setMobilePanelOpen(false)}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="ai-right-tabs">
            <button type="button" className={rightTab === "today" ? "is-active" : ""} onClick={() => setRightTab("today")}>Hoy</button>
            <button type="button" className={rightTab === "meds" ? "is-active" : ""} onClick={() => setRightTab("meds")}>Meds</button>
            <button type="button" className={rightTab === "docs" ? "is-active" : ""} onClick={() => setRightTab("docs")}>Docs</button>
          </div>

          {rightTab === "today" ? (
            <div className="ai-right-body">
              <section className="ai-widget ai-score-widget">
                <div className="ai-widget-head"><span>Estado del perfil</span></div>
                <div className="ai-score-row">
                  <Ring value={scoreData.total} />
                  <div className="ai-score-copy">
                    <strong>{scoreData.total >= 70 ? "Buen seguimiento" : "Seguimiento parcial"}</strong>
                    <p>Resumen estimado usando medicamentos, documentos y agenda registrados.</p>
                  </div>
                </div>
                <div className="ai-progress-list">
                  <div className="ai-progress-row"><span>Medicacion</span><div className="ai-progress-track"><div className="ai-progress-fill tone-teal" style={{ width: `${scoreData.medicationScore}%` }} /></div><strong>{scoreData.medicationScore}%</strong></div>
                  <div className="ai-progress-row"><span>Documentos</span><div className="ai-progress-track"><div className="ai-progress-fill tone-blue" style={{ width: `${scoreData.documentScore}%` }} /></div><strong>{scoreData.documentScore}%</strong></div>
                  <div className="ai-progress-row"><span>Citas</span><div className="ai-progress-track"><div className="ai-progress-fill tone-violet" style={{ width: `${scoreData.appointmentScore}%` }} /></div><strong>{scoreData.appointmentScore}%</strong></div>
                </div>
              </section>

              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Proxima cita</span>
                  <button type="button" onClick={() => submitPrompt(nextAppointmentPrompt)}>Ver con IA</button>
                </div>
                {nextAppointment ? (
                  <div className="ai-next-card">
                    <em>{Math.max(daysUntil(nextAppointment.date_time) || 0, 0)} dias</em>
                    <strong>{nextAppointment.specialty || APPOINTMENT_TYPE_LABELS[nextAppointment.type] || "Atencion"}</strong>
                    <p>{nextAppointment.center || "Centro por confirmar"}</p>
                    <span>{formatDateTime(nextAppointment.date_time)}</span>
                  </div>
                ) : <div className="ai-empty-note">No hay citas proximas registradas.</div>}
              </section>

              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Medicamentos hoy</span>
                  <button type="button" onClick={() => submitPrompt("Resume mi plan de medicamentos activo")}>Plan</button>
                </div>
                <div className="ai-resource-list">
                  {activeMedications.slice(0, 3).map((medication) => (
                    <div key={medication.id} className="ai-resource-item">
                      <div className="ai-resource-badge tone-teal">MED</div>
                      <div className="ai-resource-copy">
                        <strong>{medication.name}</strong>
                        <span>{medication.dose || medication.frequency || "Seguimiento activo"}</span>
                      </div>
                    </div>
                  ))}
                  {!activeMedications.length ? <div className="ai-empty-note">No hay medicamentos activos en el perfil.</div> : null}
                </div>
                {activeMedications.length > 1 ? (
                  <button type="button" className="ai-alert-card" onClick={() => submitPrompt(medsAlertPrompt)}>
                    <strong>Revision sugerida</strong>
                    <span>Verifica interacciones y orden del tratamiento con IA.</span>
                  </button>
                ) : null}
              </section>
            </div>
          ) : null}

          {rightTab === "meds" ? (
            <div className="ai-right-body">
              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Activos ({activeMedications.length})</span>
                  <button type="button" onClick={() => submitPrompt("Resume mis medicamentos activos")}>Resumir</button>
                </div>
                <div className="ai-resource-list">
                  {activeMedications.slice(0, 6).map((medication) => (
                    <div key={medication.id} className="ai-resource-item">
                      <div className="ai-resource-badge tone-teal">MED</div>
                      <div className="ai-resource-copy">
                        <strong>{medication.name}</strong>
                        <span>{medication.dose || "Sin dosis"} · {medication.frequency || "Sin frecuencia"}</span>
                      </div>
                    </div>
                  ))}
                  {!activeMedications.length ? <div className="ai-empty-note">No hay medicamentos activos para mostrar.</div> : null}
                </div>
              </section>
            </div>
          ) : null}

          {rightTab === "docs" ? (
            <div className="ai-right-body">
              <section className="ai-widget">
                <div className="ai-widget-head">
                  <span>Recientes</span>
                  <button type="button" onClick={() => submitPrompt("Resume mis documentos recientes")}>Resumir</button>
                </div>
                <div className="ai-resource-list">
                  {recentDocuments.map((document) => (
                    <div key={document.id} className="ai-resource-item">
                      <div className="ai-resource-badge tone-blue">DOC</div>
                      <div className="ai-resource-copy">
                        <strong>{DOC_LABELS[document.doc_type] || "Documento"}</strong>
                        <span>{document.center || "Sin centro"} · {formatShortDate(document.date || document.created_at)}</span>
                      </div>
                    </div>
                  ))}
                  {!recentDocuments.length ? <div className="ai-empty-note">Todavia no hay documentos guardados.</div> : null}
                </div>
              </section>
            </div>
          ) : null}

        </aside>
      </section>
    </div>
  );
}
