import React, { useState, useEffect, useRef } from "react";
import {
  getFamilyFeed,
  createFeedPost,
  deleteFeedPost,
  reactToPost,
  removeReaction,
  addPostComment,
  deletePostComment,
  uploadPostAttachment,
  getPostAttachmentUrl,
  getHealthProfiles,
} from "../api";

// ─── Constantes ──────────────────────────────────────────────────────────────

const POST_TYPES = [
  { value: "general",       label: "General",    emoji: "💬", color: "#2563eb" },
  { value: "exam_result",   label: "Examen",     emoji: "🧪", color: "#7c3aed" },
  { value: "doctor_visit",  label: "Consulta",   emoji: "🩺", color: "#0891b2" },
  { value: "medication",    label: "Medicamento",emoji: "💊", color: "#16a34a" },
];

const REACTIONS = [
  { type: "apoyo",   emoji: "💙", label: "Apoyar"   },
  { type: "animo",   emoji: "💪", label: "Ánimo"    },
  { type: "amor",    emoji: "❤️", label: "Amor"     },
  { type: "gracias", emoji: "🙏", label: "Gracias"  },
  { type: "alegra",  emoji: "😊", label: "Me alegra"},
];

const PRIMARY_REACTION = REACTIONS[0]; // 💙 Apoyar

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

// ─── Componentes ─────────────────────────────────────────────────────────────

function Avatar({ name, size = 44 }) {
  return (
    <div
      className="kfeed-avatar"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {getInitials(name)}
    </div>
  );
}

function ReactionsBar({ post, currentUserId, onReact }) {
  const [showPicker, setShowPicker] = useState(false);
  const [hoveringBtn, setHoveringBtn] = useState(false);
  const [hoveringPicker, setHoveringPicker] = useState(false);
  const hideTimer = useRef(null);

  const myReaction = REACTIONS.find((r) => r.type === post.my_reaction);
  const isReacted = !!myReaction;

  const showPickerFn = () => {
    clearTimeout(hideTimer.current);
    setShowPicker(true);
  };
  const startHidePicker = () => {
    hideTimer.current = setTimeout(() => {
      if (!hoveringBtn && !hoveringPicker) setShowPicker(false);
    }, 200);
  };

  const handleReact = async (type) => {
    setShowPicker(false);
    if (post.my_reaction === type) {
      await onReact(post.id, null);
    } else {
      await onReact(post.id, type);
    }
  };

  const handleMainClick = async () => {
    if (isReacted) {
      await onReact(post.id, null);
    } else {
      await onReact(post.id, PRIMARY_REACTION.type);
    }
  };

  return (
    <div
      className="kfeed-reaction-wrap"
      onMouseLeave={() => {
        setHoveringBtn(false);
        startHidePicker();
      }}
    >
      {showPicker && (
        <div
          className="kfeed-reaction-picker"
          onMouseEnter={() => { setHoveringPicker(true); clearTimeout(hideTimer.current); }}
          onMouseLeave={() => { setHoveringPicker(false); startHidePicker(); }}
        >
          {REACTIONS.map((r) => (
            <button
              key={r.type}
              type="button"
              className={`kfeed-reaction-option ${post.my_reaction === r.type ? "selected" : ""}`}
              onClick={() => handleReact(r.type)}
              title={r.label}
            >
              <span className="kfeed-reaction-emoji">{r.emoji}</span>
              <span className="kfeed-reaction-label">{r.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`kfeed-action-btn ${isReacted ? "kfeed-action-btn--reacted" : ""}`}
        onClick={handleMainClick}
        onMouseEnter={() => { setHoveringBtn(true); showPickerFn(); }}
        onMouseLeave={() => { setHoveringBtn(false); startHidePicker(); }}
      >
        <span className="kfeed-action-icon">
          {myReaction ? myReaction.emoji : PRIMARY_REACTION.emoji}
        </span>
        <span className="kfeed-action-label">
          {myReaction ? myReaction.label : PRIMARY_REACTION.label}
        </span>
      </button>
    </div>
  );
}

function CommentsSection({ post, currentUserId, onComment, onDeleteComment }) {
  const [text, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div className="kfeed-comments-wrap">
      {/* Input de comentario */}
      <div className="kfeed-comment-composer">
        <Avatar name={""} size={34} />
        <form className="kfeed-comment-form" onSubmit={handleSubmit}>
          <input
            className="kfeed-comment-input"
            placeholder="Añade un comentario…"
            value={text}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={submitting}
          />
          {text.trim() && (
            <button type="submit" className="kfeed-comment-send" disabled={submitting}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </form>
      </div>

      {/* Lista de comentarios */}
      {(post.comments || []).map((c) => (
        <div key={c.id} className="kfeed-comment-item">
          <Avatar name={c.user_name} size={34} />
          <div className="kfeed-comment-bubble">
            <div className="kfeed-comment-bubble-header">
              <span className="kfeed-comment-author">{c.user_name}</span>
              <span className="kfeed-comment-time">{timeAgo(c.created_at)}</span>
              {c.user_id === currentUserId && (
                <button
                  className="kfeed-comment-delete"
                  type="button"
                  onClick={() => onDeleteComment(post.id, c.id)}
                  title="Eliminar"
                >
                  ×
                </button>
              )}
            </div>
            <p className="kfeed-comment-text">{c.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PostMediaCard({ post }) {
  const typeInfo = getPostTypeInfo(post.post_type);
  const hasImages = post.attachments?.some((a) => a.attachment_type === "image");
  const hasDocs = post.attachments?.some((a) => a.attachment_type !== "image");
  const firstImage = post.attachments?.find((a) => a.attachment_type === "image");

  if (!hasImages && !hasDocs && !post.linked_document_id) return null;

  return (
    <div className="kfeed-media-card">
      {firstImage && (
        <a
          href={getPostAttachmentUrl(post.id, firstImage.id)}
          target="_blank"
          rel="noreferrer"
          className="kfeed-media-img-wrap"
        >
          <img
            src={getPostAttachmentUrl(post.id, firstImage.id)}
            alt={firstImage.filename}
            className="kfeed-media-img"
          />
        </a>
      )}
      <div className="kfeed-media-card-body" style={{ "--type-color": typeInfo.color }}>
        <div className="kfeed-media-card-tag">
          <span>{typeInfo.emoji}</span>
          <span>{typeInfo.label} · Klinip</span>
        </div>
        <p className="kfeed-media-card-title">
          {post.post_type === "exam_result"   ? "Resultados de examen compartidos"  :
           post.post_type === "doctor_visit"  ? "Nota de consulta médica"           :
           post.post_type === "medication"    ? "Actualización de medicamento"       :
                                               "Actualización de salud"}
        </p>
        <p className="kfeed-media-card-sub">Compartido de forma privada con tu familia</p>
      </div>
      {/* Otros adjuntos no-imagen */}
      {hasDocs && (
        <div className="kfeed-media-docs">
          {post.attachments.filter((a) => a.attachment_type !== "image").map((a) => (
            <a
              key={a.id}
              href={getPostAttachmentUrl(post.id, a.id)}
              target="_blank"
              rel="noreferrer"
              className="kfeed-media-doc-link"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                <path d="M7 3.5h7l3 3.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
                <path d="M14 3.5v4h3" />
                <path d="M9 12h6M9 15h6" />
              </svg>
              {a.filename || "Documento"}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, currentUserId, profiles, onDelete, onReact, onComment, onDeleteComment }) {
  const [showComments, setShowComments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const typeInfo = getPostTypeInfo(post.post_type);
  const mentionNames = (post.mention_profile_ids || [])
    .map((id) => profiles.find((p) => p.id === id)?.full_name)
    .filter(Boolean);

  const CONTENT_LIMIT = 220;
  const isLong = (post.content || "").length > CONTENT_LIMIT;
  const displayContent = isLong && !expanded
    ? post.content.slice(0, CONTENT_LIMIT) + "…"
    : post.content;

  // Suma de todas las reacciones para mostrar el conteo
  const reactionsCount = post.reactions_count || 0;

  return (
    <article className="kfeed-post-card">
      {/* ── Header ── */}
      <div className="kfeed-post-header">
        <Avatar name={post.user_name} size={46} />
        <div className="kfeed-post-header-info">
          <div className="kfeed-post-header-top">
            <span className="kfeed-post-author">{post.user_name}</span>
            <span
              className="kfeed-post-type-pill"
              style={{ "--type-color": typeInfo.color }}
            >
              {typeInfo.emoji} {typeInfo.label}
            </span>
          </div>
          <span className="kfeed-post-profile">
            {post.profile_name}
          </span>
          <span className="kfeed-post-time">
            {timeAgo(post.created_at)} ·{" "}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" style={{ verticalAlign: "middle" }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
            </svg>
            {" "}Familia
          </span>
        </div>
        {post.user_id === currentUserId && (
          <button
            className="kfeed-post-menu-btn"
            type="button"
            onClick={() => onDelete(post.id)}
            title="Eliminar publicación"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Contenido ── */}
      {post.content && (
        <div className="kfeed-post-content-wrap">
          <p className="kfeed-post-content">{displayContent}</p>
          {isLong && (
            <button
              className="kfeed-expand-btn"
              type="button"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "ver menos" : "…ver más"}
            </button>
          )}
        </div>
      )}

      {/* ── Menciones ── */}
      {mentionNames.length > 0 && (
        <p className="kfeed-post-mentions">
          {mentionNames.map((n) => (
            <span key={n} className="kfeed-mention">@{n}</span>
          ))}
        </p>
      )}

      {/* ── Media card ── */}
      <PostMediaCard post={post} />

      {/* ── Stats row ── */}
      {(reactionsCount > 0 || post.comments_count > 0) && (
        <div className="kfeed-stats-row">
          {reactionsCount > 0 && (
            <span className="kfeed-stats-reactions">
              <span className="kfeed-stats-emojis">
                {REACTIONS.slice(0, 3).map((r) => r.emoji).join("")}
              </span>
              {reactionsCount}
            </span>
          )}
          {post.comments_count > 0 && (
            <button
              type="button"
              className="kfeed-stats-comments"
              onClick={() => setShowComments((v) => !v)}
            >
              {post.comments_count} {post.comments_count === 1 ? "comentario" : "comentarios"}
            </button>
          )}
        </div>
      )}

      {/* ── Acciones ── */}
      <div className="kfeed-actions-row">
        <ReactionsBar post={post} currentUserId={currentUserId} onReact={onReact} />

        <button
          type="button"
          className="kfeed-action-btn"
          onClick={() => setShowComments((v) => !v)}
        >
          <span className="kfeed-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="kfeed-action-label">Comentar</span>
        </button>

        <button type="button" className="kfeed-action-btn">
          <span className="kfeed-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </span>
          <span className="kfeed-action-label">Compartir</span>
        </button>
      </div>

      {/* ── Comentarios ── */}
      {showComments && (
        <CommentsSection
          post={post}
          currentUserId={currentUserId}
          onComment={onComment}
          onDeleteComment={onDeleteComment}
        />
      )}
    </article>
  );
}

function CreatePostModal({ profiles, onClose, onCreate }) {
  const [content, setContent] = useState("");
  const [postType, setPostType] = useState("general");
  const [profileId, setProfileId] = useState(profiles[0]?.id || "");
  const [files, setFiles] = useState([]);
  const [mentionIds, setMentionIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const toggleMention = (id) =>
    setMentionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim() && files.length === 0) {
      setError("Escribe algo o adjunta un archivo.");
      return;
    }
    if (!profileId) {
      setError("Selecciona un perfil.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const post = await onCreate(
        {
          content: content.trim(),
          post_type: postType,
          privacy: "family",
          profile_id: Number(profileId),
          mention_profile_ids: mentionIds,
        },
        files
      );
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
    <div
      className="kfeed-modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="kfeed-modal">
        {/* Header */}
        <div className="kfeed-modal-header">
          <h3 className="kfeed-modal-title">Crear publicación</h3>
          <button className="kfeed-modal-close" type="button" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="kfeed-modal-body">
          {/* Perfil selector */}
          <div className="kfeed-modal-profile-row">
            <Avatar name={selectedProfile?.full_name || ""} size={44} />
            <div className="kfeed-modal-profile-info">
              <select
                className="kfeed-modal-profile-select"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
              <div className="kfeed-modal-privacy-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <circle cx="8" cy="9" r="2.5" />
                  <circle cx="16" cy="9" r="2.5" />
                  <path d="M3.5 19a4.5 4.5 0 0 1 9 0" />
                  <path d="M11.5 19a4.5 4.5 0 0 1 9 0" />
                </svg>
                Solo familia · {" "}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" style={{marginLeft:2}}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
          </div>

          {/* Textarea */}
          <textarea
            className="kfeed-modal-textarea"
            placeholder="¿Qué quieres compartir con tu familia?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            autoFocus
          />

          {/* Tipo de publicación */}
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

          {/* Etiquetar familiares */}
          {otherProfiles.length > 0 && (
            <div className="kfeed-modal-section">
              <p className="kfeed-modal-section-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                  <line x1="7" y1="7" x2="7.01" y2="7"/>
                </svg>
                Etiquetar
              </p>
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

          {/* Adjuntar archivos */}
          <div className="kfeed-modal-toolbar">
            <button
              type="button"
              className="kfeed-toolbar-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Adjuntar archivo"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>Foto / Video</span>
            </button>
            <button
              type="button"
              className="kfeed-toolbar-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Adjuntar documento"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>Documento</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx"
              style={{ display: "none" }}
              onChange={(e) => setFiles(Array.from(e.target.files))}
            />
          </div>

          {files.length > 0 && (
            <ul className="kfeed-file-list">
              {files.map((f, i) => (
                <li key={i} className="kfeed-file-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  {f.name}
                  <button
                    type="button"
                    className="kfeed-file-remove"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >×</button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="kfeed-modal-error">{error}</p>}

          <div className="kfeed-modal-footer">
            <button
              type="submit"
              className="kfeed-publish-btn"
              disabled={submitting || (!content.trim() && files.length === 0)}
            >
              {submitting ? "Publicando…" : "Publicar"}
            </button>
          </div>
        </form>
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
  const skipRef = useRef(0);
  const LIMIT = 20;

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

  async function handleCreate(payload, files) {
    const post = await createFeedPost(payload);
    if (files?.length > 0) {
      for (const file of files) {
        const type = file.type.startsWith("image/") ? "image"
          : file.type.startsWith("video/") ? "video"
          : "document";
        const att = await uploadPostAttachment(post.id, file, type);
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
    if (!reactionType) {
      await removeReaction(postId);
      setPosts((prev) => prev.map((p) =>
        p.id !== postId ? p : { ...p, my_reaction: null, reactions_count: Math.max(0, p.reactions_count - 1) }
      ));
    } else {
      await reactToPost(postId, reactionType);
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId) return p;
        const wasReacted = !!p.my_reaction;
        return { ...p, my_reaction: reactionType, reactions_count: wasReacted ? p.reactions_count : p.reactions_count + 1 };
      }));
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

  return (
    <div className="kfeed-page">
      {/* ── Header de sección ── */}
      <div className="kfeed-page-header">
        <div className="kfeed-page-header-text">
          <div className="kfeed-brand-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22" style={{color:"#2563eb"}}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <h1 className="kfeed-page-title">KlinipFeed</h1>
          </div>
          <p className="kfeed-page-subtitle">Comparte tu salud con tu familia</p>
        </div>
      </div>

      {/* ── Composer ── */}
      <div className="kfeed-composer-card">
        <Avatar name={user?.name || ""} size={44} />
        <button
          type="button"
          className="kfeed-composer-trigger"
          onClick={() => setShowCreate(true)}
          disabled={profiles.length === 0}
        >
          ¿Qué quieres compartir con tu familia?
        </button>
      </div>

      {/* ── Estados ── */}
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
              <circle cx="40" cy="40" r="38" fill="#eff6ff" />
              <path d="M40 22c-9.9 0-18 8.1-18 18s8.1 18 18 18 18-8.1 18-18-8.1-18-18-18z" fill="#bfdbfe"/>
              <path d="M40 30v10l6 3" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M28 54a14 14 0 0 1 24 0" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h3 className="kfeed-empty-title">Tu familia aún no ha publicado nada</h3>
          <p className="kfeed-empty-sub">Sé el primero en compartir una actualización de salud.</p>
          <button
            type="button"
            className="kfeed-publish-btn"
            onClick={() => setShowCreate(true)}
            disabled={profiles.length === 0}
          >
            + Crear publicación
          </button>
        </div>
      )}

      {/* ── Feed ── */}
      <div className="kfeed-list">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={user?.id}
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
          <button
            type="button"
            className="secondary-btn"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Cargando…" : "Ver más publicaciones"}
          </button>
        </div>
      )}

      {showCreate && profiles.length > 0 && (
        <CreatePostModal
          profiles={profiles}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
