import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import {
  getFamilyFeed,
  createFeedPost,
  deleteFeedPost,
  reactToPost,
  removeReaction,
  addPostComment,
  deletePostComment,
  uploadPostAttachment,
  getHealthProfiles,
  uploadHealthProfileAvatar,
} from "../api";

const API_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8000");

// ─── Auth file helpers ────────────────────────────────────────────────────────

// Carga un archivo protegido con token y devuelve blob URL
function useAuthFile(postId, attachmentId, previewUrl) {
  const [src, setSrc] = useState(previewUrl || null);
  const [loading, setLoading] = useState(!previewUrl);
  const revokeRef = useRef(null);

  useEffect(() => {
    // Si ya tenemos previewUrl local (recién subido), usarla directamente
    if (previewUrl) {
      setSrc(previewUrl);
      setLoading(false);
      return;
    }
    if (!postId || !attachmentId) return;

    setLoading(true);
    const token = localStorage.getItem("token");
    axios
      .get(`${API_URL}/feed/posts/${postId}/attachments/${attachmentId}/file`, {
        responseType: "blob",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then((res) => {
        if (revokeRef.current) URL.revokeObjectURL(revokeRef.current);
        const url = URL.createObjectURL(res.data);
        revokeRef.current = url;
        setSrc(url);
      })
      .catch(() => setSrc(null))
      .finally(() => setLoading(false));

    return () => {
      if (revokeRef.current) URL.revokeObjectURL(revokeRef.current);
    };
  }, [postId, attachmentId, previewUrl]);

  return { src, loading };
}

function AuthImage({ postId, attachmentId, filename, previewUrl, className, onClick }) {
  const { src, loading } = useAuthFile(postId, attachmentId, previewUrl);
  if (loading) return <div className="kfeed-attachment-loading" />;
  if (!src) return null;
  return <img src={src} alt={filename} className={className} onClick={onClick} style={onClick ? { cursor: "pointer" } : {}} />;
}

function AuthPDF({ postId, attachmentId, filename, previewUrl }) {
  const { src, loading } = useAuthFile(postId, attachmentId, previewUrl);
  if (loading) return (
    <div className="kfeed-pdf-loading">
      <div className="kfeed-spinner" style={{ width: 20, height: 20 }} />
      <span>Cargando PDF…</span>
    </div>
  );
  if (!src) return null;
  return (
    <div className="kfeed-pdf-viewer">
      <div className="kfeed-pdf-topbar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" style={{ color: "#dc2626", flexShrink: 0 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
          <polyline points="9 9 10 9"/>
        </svg>
        <span className="kfeed-pdf-name">{filename || "Documento PDF"}</span>
        <button type="button" className="kfeed-pdf-open-btn" onClick={() => window.open(src, "_blank")}>
          Abrir
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      </div>
      <embed src={src} type="application/pdf" className="kfeed-pdf-embed" />
    </div>
  );
}

function openAuthFile(postId, attachmentId) {
  const token = localStorage.getItem("token");
  axios
    .get(`${API_URL}/feed/posts/${postId}/attachments/${attachmentId}/file`, {
      responseType: "blob",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    .then((res) => {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const POST_TYPES = [
  { value: "general",      label: "General",     emoji: "💬", color: "#2563eb" },
  { value: "exam_result",  label: "Examen",      emoji: "🧪", color: "#7c3aed" },
  { value: "doctor_visit", label: "Consulta",    emoji: "🩺", color: "#0891b2" },
  { value: "medication",   label: "Medicamento", emoji: "💊", color: "#16a34a" },
];

const REACTIONS = [
  { type: "apoyo",   emoji: "💙", label: "Apoyar"    },
  { type: "animo",   emoji: "💪", label: "Ánimo"     },
  { type: "amor",    emoji: "❤️", label: "Amor"      },
  { type: "gracias", emoji: "🙏", label: "Gracias"   },
  { type: "alegra",  emoji: "😊", label: "Me alegra" },
];

const PRIMARY_REACTION = REACTIONS[0];

function getReactionByType(type) {
  return REACTIONS.find((reaction) => reaction.type === type) || PRIMARY_REACTION;
}

function getReactionLabel(reaction) {
  if (!reaction) return PRIMARY_REACTION.label;
  return reaction.type === "animo" ? "\u00c1nimo" : reaction.label;
}

const COMMENT_EMOJIS = ["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d`;
  return new Date(dateStr).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

function getPostTypeInfo(type) {
  return POST_TYPES.find((t) => t.value === type) || POST_TYPES[0];
}

function getInitials(name = "") {
  return name.trim().split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 44, avatarUrl = null }) {
  return (
    <div className="kfeed-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {avatarUrl
        ? <img src={avatarUrl} alt={name} className="kfeed-avatar-img" />
        : getInitials(name)
      }
    </div>
  );
}

// ─── Reactions bar ────────────────────────────────────────────────────────────

function ReactionsBar({ post, onReact, disabled = false }) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef(null);
  const btnRef = useRef(null);
  const holdTimer = useRef(null);

  const myReaction = post.my_reaction ? getReactionByType(post.my_reaction) : null;
  const isReacted = !!myReaction;

  // Cerrar picker al click fuera
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const handleMainClick = async () => {
    if (disabled) return;
    clearTimeout(holdTimer.current);
    setShowPicker(false);
    if (isReacted) {
      await onReact(post.id, null);
    } else {
      await onReact(post.id, PRIMARY_REACTION.type);
    }
  };

  const handleMouseDown = () => {
    if (disabled) return;
    holdTimer.current = setTimeout(() => setShowPicker(true), 400);
  };
  const handleMouseUp = () => clearTimeout(holdTimer.current);

  const handleReact = async (type) => {
    if (disabled) return;
    setShowPicker(false);
    await onReact(post.id, post.my_reaction === type ? null : type);
  };

  return (
    <div className="kfeed-reaction-wrap">
      {showPicker && (
        <div className="kfeed-reaction-picker" ref={pickerRef}>
          {REACTIONS.map((r) => (
            <button
              key={r.type}
              type="button"
              className={`kfeed-reaction-option ${post.my_reaction === r.type ? "selected" : ""}`}
              onClick={() => handleReact(r.type)}
              title={getReactionLabel(r)}
            >
              <span className="kfeed-reaction-emoji">{r.emoji}</span>
              <span className="kfeed-reaction-label">{getReactionLabel(r)}</span>
            </button>
          ))}
        </div>
      )}
      <button
        ref={btnRef}
        type="button"
        className={`kfeed-action-btn ${isReacted ? "kfeed-action-btn--reacted" : ""}`}
        onClick={handleMainClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        disabled={disabled}
        aria-busy={disabled}
        title="Mantén presionado para elegir reacción"
      >
        <span className="kfeed-action-icon">{myReaction ? myReaction.emoji : PRIMARY_REACTION.emoji}</span>
        <span className="kfeed-action-label">{getReactionLabel(myReaction || PRIMARY_REACTION)}</span>
      </button>
    </div>
  );
}

// ─── Comments section (estilo Instagram) ─────────────────────────────────────

function CommentsSection({ post, currentUserId, userName, onComment, onDeleteComment }) {
  const [text, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await onComment(post.id, text.trim());
      setCommentText("");
    } finally {
      setSubmitting(false);
    }
  };

  const insertEmoji = (emoji) => {
    setCommentText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  return (
    <div className="kfeed-comments-section">
      {/* Lista de comentarios estilo Instagram */}
      {(post.comments || []).length > 0 && (
        <div className="kfeed-comments-list">
          {(post.comments || []).map((c) => (
            <div key={c.id} className="kfeed-ig-comment">
              <Avatar name={c.user_name} size={32} />
              <div className="kfeed-ig-comment-body">
                <div className="kfeed-ig-comment-line">
                  <span className="kfeed-ig-comment-author">{c.user_name}</span>
                  <span className="kfeed-ig-comment-text">{c.content}</span>
                </div>
                <div className="kfeed-ig-comment-meta">
                  <span className="kfeed-ig-comment-time">{timeAgo(c.created_at)}</span>
                  {c.user_id === currentUserId && (
                    <button
                      type="button"
                      className="kfeed-ig-comment-delete"
                      onClick={() => onDeleteComment(post.id, c.id)}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
              <button type="button" className="kfeed-ig-comment-heart" aria-label="Me gusta comentario">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Barra de emojis rápidos */}
      <div className="kfeed-comment-emoji-bar">
        {COMMENT_EMOJIS.map((em) => (
          <button key={em} type="button" className="kfeed-comment-emoji-btn" onClick={() => insertEmoji(em)}>
            {em}
          </button>
        ))}
      </div>

      {/* Input de comentario */}
      <form className="kfeed-comment-composer" onSubmit={handleSubmit}>
        <Avatar name={userName || ""} size={32} />
        <div className="kfeed-comment-input-wrap">
          <input
            ref={inputRef}
            className="kfeed-comment-input"
            placeholder="\u00danete a la conversaci\u00f3n..."
            value={text}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={submitting}
          />
          <button
            type="submit"
            className="kfeed-comment-send-btn"
            disabled={submitting || !text.trim()}
          >
            {submitting ? "Publicando..." : "Publicar"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Media card ───────────────────────────────────────────────────────────────

function isPdf(attachment) {
  return (
    (attachment.filename || "").toLowerCase().endsWith(".pdf") ||
    attachment.attachment_type === "document"
  );
}

function PostMediaCard({ post }) {
  const typeInfo = getPostTypeInfo(post.post_type);
  const images = (post.attachments || []).filter((a) => a.attachment_type === "image");
  const pdfs   = (post.attachments || []).filter((a) => isPdf(a));
  const otherDocs = (post.attachments || []).filter((a) => a.attachment_type !== "image" && !isPdf(a));
  const hasAny = images.length > 0 || pdfs.length > 0 || otherDocs.length > 0;

  if (!hasAny && post.post_type === "general") return null;

  return (
    <div className="kfeed-media-card">
      {/* Imágenes */}
      {images.map((img) => (
        <AuthImage
          key={img.id}
          postId={post.id}
          attachmentId={img.id}
          filename={img.filename}
          previewUrl={img.preview_url || null}
          className="kfeed-media-img"
          onClick={() => openAuthFile(post.id, img.id)}
        />
      ))}

      {/* PDFs inline */}
      {pdfs.map((doc) => (
        <AuthPDF
          key={doc.id}
          postId={post.id}
          attachmentId={doc.id}
          filename={doc.filename}
          previewUrl={doc.preview_url || null}
        />
      ))}

      {/* Card de tipo */}
      <div className="kfeed-media-card-body" style={{ "--type-color": typeInfo.color }}>
        <div className="kfeed-media-card-tag">
          <span>{typeInfo.emoji}</span>
          <span>{typeInfo.label} · Klinip</span>
        </div>
        <p className="kfeed-media-card-title">
          {post.post_type === "exam_result"  ? "Resultados de examen compartidos" :
           post.post_type === "doctor_visit" ? "Nota de consulta médica"          :
           post.post_type === "medication"   ? "Actualización de medicamento"      :
                                              "Actualización de salud"}
        </p>
        <p className="kfeed-media-card-sub">Compartido de forma privada con tu familia</p>
      </div>

      {/* Otros documentos (no PDF) */}
      {otherDocs.length > 0 && (
        <div className="kfeed-media-docs">
          {otherDocs.map((a) => (
            <button
              key={a.id}
              type="button"
              className="kfeed-media-doc-link"
              onClick={() => a.preview_url ? window.open(a.preview_url, "_blank") : openAuthFile(post.id, a.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                <path d="M7 3.5h7l3 3.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/>
                <path d="M14 3.5v4h3"/><path d="M9 12h6M9 15h6"/>
              </svg>
              {a.filename || "Documento"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Post card ────────────────────────────────────────────────────────────────

function PostCard({ post, currentUserId, userName, profiles, onDelete, onReact, onComment, onDeleteComment }) {
  const [showComments, setShowComments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const typeInfo = getPostTypeInfo(post.post_type);
  const statsReaction = post.my_reaction ? getReactionByType(post.my_reaction) : PRIMARY_REACTION;

  const mentionNames = (post.mention_profile_ids || [])
    .map((id) => profiles.find((p) => p.id === id)?.full_name)
    .filter(Boolean);

  const LIMIT = 280;
  const isLong = (post.content || "").length > LIMIT;
  const displayContent = isLong && !expanded ? post.content.slice(0, LIMIT) + "…" : post.content;

  return (
    <article className="kfeed-post-card">
      {/* Header */}
      <div className="kfeed-post-header">
        <Avatar name={post.user_name} size={46} avatarUrl={post.user_avatar_url || null} />
        <div className="kfeed-post-header-info">
          <div className="kfeed-post-header-top">
            <span className="kfeed-post-author">{post.user_name}</span>
            <span className="kfeed-post-type-pill" style={{ "--type-color": typeInfo.color }}>
              {typeInfo.emoji} {typeInfo.label}
            </span>
          </div>
          <span className="kfeed-post-profile">{post.profile_name}</span>
          <span className="kfeed-post-time">
            {timeAgo(post.created_at)} ·{" "}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" style={{ verticalAlign: "middle" }}>
              <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/>
            </svg>
            {" "}Familia
          </span>
        </div>
        {post.user_id === currentUserId && (
          <button className="kfeed-post-menu-btn" type="button" onClick={() => onDelete(post.id)} title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Contenido */}
      {post.content && (
        <div className="kfeed-post-content-wrap">
          <p className="kfeed-post-content">{displayContent}</p>
          {isLong && (
            <button className="kfeed-expand-btn" type="button" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "ver menos" : "…ver más"}
            </button>
          )}
        </div>
      )}

      {/* Menciones */}
      {mentionNames.length > 0 && (
        <p className="kfeed-post-mentions">
          {mentionNames.map((n) => <span key={n} className="kfeed-mention">@{n}</span>)}
        </p>
      )}

      {/* Media */}
      <PostMediaCard post={post} />

      {/* Stats */}
      {(post.reactions_count > 0 || post.comments_count > 0) && (
        <div className="kfeed-stats-row">
          {post.reactions_count > 0 && (
            <span className="kfeed-stats-reactions">
              <span className="kfeed-stats-emojis" aria-hidden="true">{statsReaction.emoji}</span>
              {post.reactions_count}
            </span>
          )}
          {post.comments_count > 0 && (
            <button type="button" className="kfeed-stats-comments" onClick={() => setShowComments((v) => !v)}>
              {post.comments_count} {post.comments_count === 1 ? "comentario" : "comentarios"}
            </button>
          )}
        </div>
      )}

      {/* Acciones */}
      <div className="kfeed-actions-row">
        <ReactionsBar post={post} onReact={onReact} disabled={post.is_reacting} />

        <button type="button" className="kfeed-action-btn" onClick={() => setShowComments((v) => !v)}>
          <span className="kfeed-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span className="kfeed-action-label">Comentar</span>
        </button>

        <button type="button" className="kfeed-action-btn">
          <span className="kfeed-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          </span>
          <span className="kfeed-action-label">Compartir</span>
        </button>
      </div>

      {/* Comentarios */}
      {showComments && (
        <CommentsSection
          post={post}
          currentUserId={currentUserId}
          userName={userName}
          onComment={onComment}
          onDeleteComment={onDeleteComment}
        />
      )}
    </article>
  );
}

// ─── Modal crear post ─────────────────────────────────────────────────────────

function CreatePostModal({ profiles, userName, onClose, onCreate }) {
  const [content, setContent] = useState("");
  const [postType, setPostType] = useState("general");
  const [profileId, setProfileId] = useState(profiles[0]?.id || "");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [mentionIds, setMentionIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const toggleMention = (id) =>
    setMentionIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleFiles = (selected) => {
    const arr = Array.from(selected);
    setFiles(arr);
    // Generar previews locales
    const urls = arr.map((f) => ({ name: f.name, url: URL.createObjectURL(f), type: f.type }));
    // Limpiar previews anteriores
    setPreviews((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return urls; });
  };

  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim() && files.length === 0) { setError("Escribe algo o adjunta un archivo."); return; }
    if (!profileId) { setError("Selecciona un perfil."); return; }
    setSubmitting(true);
    setError("");
    try {
      const post = await onCreate({
        content: content.trim(),
        post_type: postType,
        privacy: "family",
        profile_id: Number(profileId),
        mention_profile_ids: mentionIds,
      }, files, previews);
      if (post) onClose();
    } catch {
      setError("No se pudo publicar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProfile = profiles.find((p) => p.id === Number(profileId));
  const otherProfiles = profiles.filter((p) => p.id !== Number(profileId));

  return (
    <div className="kfeed-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kfeed-modal">
        <div className="kfeed-modal-header">
          <h3 className="kfeed-modal-title">Crear publicación</h3>
          <button className="kfeed-modal-close" type="button" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="kfeed-modal-body">
          <div className="kfeed-modal-profile-row">
            <Avatar name={selectedProfile?.full_name || ""} size={44} />
            <div className="kfeed-modal-profile-info">
              <select className="kfeed-modal-profile-select" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <div className="kfeed-modal-privacy-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="9" r="2.5"/>
                  <path d="M3.5 19a4.5 4.5 0 0 1 9 0"/><path d="M11.5 19a4.5 4.5 0 0 1 9 0"/>
                </svg>
                Solo familia
              </div>
            </div>
          </div>

          <textarea
            className="kfeed-modal-textarea"
            placeholder="¿Qué quieres compartir con tu familia?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            autoFocus
          />

          {/* Previews de imágenes */}
          {previews.filter((p) => p.type.startsWith("image/")).length > 0 && (
            <div className="kfeed-preview-grid">
              {previews.filter((p) => p.type.startsWith("image/")).map((p) => (
                <img key={p.url} src={p.url} alt={p.name} className="kfeed-preview-img" />
              ))}
            </div>
          )}

          {/* Tipo */}
          <div className="kfeed-modal-types">
            {POST_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`kfeed-type-chip ${postType === t.value ? "active" : ""}`}
                style={postType === t.value ? { "--type-color": t.color } : {}}
                onClick={() => setPostType(t.value)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>

          {/* Etiquetar */}
          {otherProfiles.length > 0 && (
            <div className="kfeed-modal-section">
              <p className="kfeed-modal-section-label">Etiquetar familiares</p>
              <div className="kfeed-modal-mentions">
                {otherProfiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`kfeed-mention-chip ${mentionIds.includes(p.id) ? "active" : ""}`}
                    onClick={() => toggleMention(p.id)}
                  >
                    @{p.full_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="kfeed-modal-toolbar">
            <button type="button" className="kfeed-toolbar-btn" onClick={() => fileInputRef.current?.click()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span>Foto / Video</span>
            </button>
            <button type="button" className="kfeed-toolbar-btn" onClick={() => fileInputRef.current?.click()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>Documento</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx"
              style={{ display: "none" }}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* Lista archivos no-imagen */}
          {previews.filter((p) => !p.type.startsWith("image/")).length > 0 && (
            <ul className="kfeed-file-list">
              {previews.filter((p) => !p.type.startsWith("image/")).map((p, i) => (
                <li key={i} className="kfeed-file-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  {p.name}
                  <button type="button" className="kfeed-file-remove" onClick={() => {
                    setFiles((prev) => prev.filter((_, idx) => idx !== i));
                    setPreviews((prev) => { URL.revokeObjectURL(prev[i].url); return prev.filter((_, idx) => idx !== i); });
                  }}>×</button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="kfeed-modal-error">{error}</p>}

          <div className="kfeed-modal-footer">
            <button type="submit" className="kfeed-publish-btn" disabled={submitting || (!content.trim() && files.length === 0)}>
              {submitting ? "Publicando…" : "Publicar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sidebar de familia (desktop) ────────────────────────────────────────────

function FamilySidebar({ user, profiles, onAvatarUpload, isOpen = false, onClose }) {
  const primaryProfile = profiles.find((p) => p.is_primary_profile) || profiles[0];
  const familyProfiles = profiles.filter((p) => !p.is_primary_profile && !p.is_archived);
  const avatarInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !primaryProfile) return;
    setUploading(true);
    try {
      await onAvatarUpload(primaryProfile.id, file);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <aside className={`kfeed-sidebar${isOpen ? " is-open" : ""}`}>
      {/* Botón cerrar (solo móvil) */}
      <div className="kfeed-sidebar-mobile-header">
        <span className="kfeed-sidebar-mobile-title">Mi familia</span>
        <button type="button" className="kfeed-sidebar-close-btn" onClick={onClose} aria-label="Cerrar panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Usuario actual */}
      <div className="kfeed-sidebar-user-row">
        <div className="kfeed-sidebar-avatar-wrap">
          <Avatar name={user?.name || ""} size={46} avatarUrl={primaryProfile?.avatar_url || null} />
          <button
            type="button"
            className="kfeed-sidebar-avatar-edit-btn"
            title="Cambiar foto de perfil"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <div className="kfeed-spinner" style={{ width: 11, height: 11 }} />
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
            }
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />
        </div>
        <div className="kfeed-sidebar-user-info">
          <span className="kfeed-sidebar-username">{user?.name || ""}</span>
          <span className="kfeed-sidebar-userprofile">{primaryProfile?.full_name || ""}</span>
        </div>
      </div>

      {/* Familia */}
      {familyProfiles.length > 0 && (
        <div className="kfeed-sidebar-family-section">
          <div className="kfeed-sidebar-family-header">
            <span>Tu familia</span>
          </div>
          {familyProfiles.slice(0, 6).map((p) => (
            <FamilyMemberRow key={p.id} profile={p} onAvatarUpload={onAvatarUpload} />
          ))}
        </div>
      )}
    </aside>
  );
}

function FamilyMemberRow({ profile, onAvatarUpload }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await onAvatarUpload(profile.id, file);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="kfeed-sidebar-member-row">
      <div className="kfeed-sidebar-avatar-wrap">
        <Avatar name={profile.full_name} size={38} avatarUrl={profile.avatar_url || null} />
        <button
          type="button"
          className="kfeed-sidebar-avatar-edit-btn kfeed-sidebar-avatar-edit-sm"
          title="Cambiar foto"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading
            ? <div className="kfeed-spinner" style={{ width: 9, height: 9 }} />
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="9" height="9">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
          }
        </button>
        <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleChange} />
      </div>
      <div className="kfeed-sidebar-member-info">
        <span className="kfeed-sidebar-member-name">{profile.full_name}</span>
        <span className="kfeed-sidebar-member-rel">{profile.relation_with_owner || "Familiar"}</span>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function KlinipFeed({ user }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [familySidebarOpen, setFamilySidebarOpen] = useState(false);
  const skipRef = useRef(0);
  const LIMIT = 20;

  async function handleAvatarUpload(profileId, file) {
    const result = await uploadHealthProfileAvatar(profileId, file);
    if (result?.avatar_url) {
      setProfiles((prev) =>
        prev.map((p) => p.id === profileId ? { ...p, avatar_url: result.avatar_url } : p)
      );
    }
  }

  useEffect(() => { loadInitial(); }, []);

  async function loadInitial() {
    setLoading(true);
    setError("");
    try {
      const [feed, profs] = await Promise.all([
        getFamilyFeed({ skip: 0, limit: LIMIT }),
        getHealthProfiles(),
      ]);
      setPosts(feed);
      setProfiles(profs);
      skipRef.current = feed.length;
      setHasMore(feed.length === LIMIT);
    } catch {
      setError("No se pudo cargar el feed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const more = await getFamilyFeed({ skip: skipRef.current, limit: LIMIT });
      setPosts((prev) => [...prev, ...more]);
      skipRef.current += more.length;
      setHasMore(more.length === LIMIT);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleCreate(payload, files, previews) {
    const post = await createFeedPost(payload);
    if (files?.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const preview = previews?.[i];
        const type = file.type.startsWith("image/") ? "image"
          : file.type.startsWith("video/") ? "video" : "document";
        const att = await uploadPostAttachment(post.id, file, type);
        // Adjuntar preview URL local para mostrar inmediatamente sin re-fetch
        att.preview_url = preview?.url || null;
        post.attachments = [...(post.attachments || []), att];
      }
    }
    setPosts((prev) => [post, ...prev]);
    return post;
  }

  async function handleDelete(postId) {
    if (!window.confirm("¿Eliminar esta publicación?")) return;
    await deleteFeedPost(postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }

  async function handleReact(postId, reactionType) {
    const targetPost = posts.find((post) => post.id === postId);
    if (!targetPost || targetPost.is_reacting) return;

    setPosts((prev) => prev.map((p) =>
      p.id !== postId ? p : { ...p, is_reacting: true }
    ));

    try {
      if (!reactionType) {
        await removeReaction(postId);
        setPosts((prev) => prev.map((p) =>
          p.id !== postId
            ? p
            : {
                ...p,
                my_reaction: null,
                reactions_count: Math.max(0, p.reactions_count - 1),
                is_reacting: false,
              }
        ));
        return;
      }

      await reactToPost(postId, reactionType);
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          my_reaction: reactionType,
          reactions_count: p.my_reaction ? p.reactions_count : p.reactions_count + 1,
          is_reacting: false,
        };
      }));
    } catch (error) {
      setPosts((prev) => prev.map((p) =>
        p.id !== postId ? p : { ...p, is_reacting: false }
      ));
      throw error;
    }
  }

  async function handleComment(postId, content) {
    const comment = await addPostComment(postId, content);
    setPosts((prev) => prev.map((p) =>
      p.id !== postId ? p : { ...p, comments: [...(p.comments || []), comment], comments_count: p.comments_count + 1 }
    ));
  }

  async function handleDeleteComment(postId, commentId) {
    await deletePostComment(postId, commentId);
    setPosts((prev) => prev.map((p) =>
      p.id !== postId ? p : {
        ...p,
        comments: (p.comments || []).filter((c) => c.id !== commentId),
        comments_count: Math.max(0, p.comments_count - 1),
      }
    ));
  }

  const primaryProfile = profiles.find((p) => p.is_primary_profile) || profiles[0];
  const userAvatarUrl = primaryProfile?.avatar_url || null;

  return (
    <div className="kfeed-layout-wrapper">
      <div className="kfeed-page">
        {/* Header */}
        <div className="kfeed-page-header">
          <div className="kfeed-brand-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22" style={{ color: "#2563eb" }}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <h1 className="kfeed-page-title">KlinipFeed</h1>
            {profiles.length > 0 && (
              <button
                type="button"
                className="kfeed-family-panel-btn"
                onClick={() => setFamilySidebarOpen(true)}
                title="Ver familia"
                aria-label="Abrir panel de familia"
              >
                <Avatar name={user?.name || ""} size={28} avatarUrl={userAvatarUrl} />
              </button>
            )}
          </div>
          <p className="kfeed-page-subtitle">Comparte tu salud con tu familia</p>
        </div>

        {/* Composer */}
        <div className="kfeed-composer-card">
          <Avatar name={user?.name || ""} size={44} avatarUrl={userAvatarUrl} />
          <button type="button" className="kfeed-composer-trigger" onClick={() => setShowCreate(true)} disabled={profiles.length === 0}>
            ¿Qué quieres compartir con tu familia?
          </button>
        </div>

      {loading && (
        <div className="kfeed-state-center">
          <div className="kfeed-spinner" />
          <p>Cargando publicaciones…</p>
        </div>
      )}
      {!loading && error && (
        <div className="kfeed-state-center kfeed-state-error">
          <p>{error}</p>
          <button className="secondary-btn" type="button" onClick={loadInitial}>Reintentar</button>
        </div>
      )}
      {!loading && !error && posts.length === 0 && (
        <div className="kfeed-empty-state">
          <div className="kfeed-empty-illus">
            <svg viewBox="0 0 80 80" fill="none" width="80" height="80">
              <circle cx="40" cy="40" r="38" fill="#eff6ff"/>
              <path d="M40 22c-9.9 0-18 8.1-18 18s8.1 18 18 18 18-8.1 18-18-8.1-18-18-18z" fill="#bfdbfe"/>
              <path d="M40 30v10l6 3" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M28 54a14 14 0 0 1 24 0" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h3 className="kfeed-empty-title">Tu familia aún no ha publicado nada</h3>
          <p className="kfeed-empty-sub">Sé el primero en compartir una actualización de salud.</p>
          <button type="button" className="kfeed-publish-btn" onClick={() => setShowCreate(true)} disabled={profiles.length === 0}>
            + Crear publicación
          </button>
        </div>
      )}

      <div className="kfeed-list">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={user?.id}
            userName={user?.name || ""}
            profiles={profiles}
            onDelete={handleDelete}
            onReact={handleReact}
            onComment={handleComment}
            onDeleteComment={handleDeleteComment}
          />
        ))}
      </div>

      {hasMore && !loading && posts.length > 0 && (
        <div className="kfeed-load-more">
          <button type="button" className="secondary-btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Cargando…" : "Ver más publicaciones"}
          </button>
        </div>
      )}

        {showCreate && profiles.length > 0 && (
          <CreatePostModal
            profiles={profiles}
            userName={user?.name || ""}
            onClose={() => setShowCreate(false)}
            onCreate={handleCreate}
          />
        )}
      </div>

      {/* Backdrop móvil */}
      {profiles.length > 0 && (
        <div
          className={`kfeed-sidebar-backdrop${familySidebarOpen ? " is-visible" : ""}`}
          onClick={() => setFamilySidebarOpen(false)}
        />
      )}

      {/* Sidebar (desktop columna / mobile drawer) */}
      {profiles.length > 0 && (
        <FamilySidebar
          user={user}
          profiles={profiles}
          onAvatarUpload={handleAvatarUpload}
          isOpen={familySidebarOpen}
          onClose={() => setFamilySidebarOpen(false)}
        />
      )}
    </div>
  );
}
