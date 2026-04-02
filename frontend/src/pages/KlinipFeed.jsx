import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  getFamilyFeed,
  createFeedPost,
  updateFeedPost,
  deleteFeedPost,
  reactToPost,
  removeReaction,
  addPostComment,
  deletePostComment,
  likePostComment,
  unlikePostComment,
  uploadPostAttachment,
  getHealthProfiles,
  getProfileCaregivers,
  getPostAttachmentUrl,
  uploadHealthProfileAvatar,
} from "../api";
import StepUpModal from "../components/StepUpModal";

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

function getAttachmentExtension(filename = "") {
  const normalized = String(filename || "").toLowerCase().trim();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}

function getVideoMimeType(filename = "") {
  const ext = getAttachmentExtension(filename);
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".ogg" || ext === ".ogv") return "video/ogg";
  return "video/mp4";
}

function AuthVideo({ postId, attachmentId, filename, previewUrl }) {
  const [expanded, setExpanded] = useState(false);
  const src = previewUrl || getPostAttachmentUrl(postId, attachmentId);
  if (!src) return null;
  return (
    <>
      <div className="kfeed-video-viewer">
        <div className="kfeed-video-topbar">
          <span className="kfeed-video-name">{filename || "Video adjunto"}</span>
          <button type="button" className="kfeed-video-open-btn" onClick={() => setExpanded(true)}>
            Ver grande
          </button>
        </div>
        <video className="kfeed-media-video" controls playsInline preload="metadata">
          <source src={src} type={getVideoMimeType(filename)} />
          Tu navegador no pudo reproducir este video.
        </video>
      </div>
      {expanded ? (
        <div className="kfeed-video-modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="kfeed-video-modal" onClick={(event) => event.stopPropagation()}>
            <div className="kfeed-video-modal-head">
              <strong>{filename || "Video adjunto"}</strong>
              <button
                type="button"
                className="kfeed-video-modal-close"
                onClick={() => setExpanded(false)}
                aria-label="Cerrar visor de video"
              >
                &times;
              </button>
            </div>
            <video className="kfeed-video-modal-player" controls playsInline autoPlay preload="metadata">
              <source src={src} type={getVideoMimeType(filename)} />
              Tu navegador no pudo reproducir este video.
            </video>
          </div>
        </div>
      ) : null}
    </>
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

function escapeRegExp(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCommentTree(comments = []) {
  const sorted = [...comments].sort((a, b) => {
    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return (a.id || 0) - (b.id || 0);
  });
  const byParent = new Map();
  sorted.forEach((comment) => {
    const parentId = comment.parent_comment_id || 0;
    const bucket = byParent.get(parentId) || [];
    bucket.push(comment);
    byParent.set(parentId, bucket);
  });

  const attachReplies = (parentId = 0, depth = 0) =>
    (byParent.get(parentId) || []).map((comment) => ({
      ...comment,
      depth,
      replies: attachReplies(comment.id, depth + 1),
    }));

  return attachReplies(0, 0);
}

function getMentionSearchState(value = "", caret = value.length) {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] || "";
  return {
    query: query.toLowerCase(),
    start: caret - query.length - 1,
    end: caret,
  };
}

function extractMentionUserIds(content = "", mentionCandidates = []) {
  const mentionIds = [];
  mentionCandidates.forEach((candidate) => {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(candidate.label)}(?=\\s|$|[.,!?;:])`, "i");
    if (pattern.test(content) && !mentionIds.includes(candidate.user_id)) {
      mentionIds.push(candidate.user_id);
    }
  });
  return mentionIds;
}

function buildMentionCandidates({ user, profiles, groupCaregivers, posts }) {
  const rawCandidates = [];
  const pushCandidate = (userId, baseLabel, avatarUrl = null) => {
    const cleanLabel = (baseLabel || "").trim();
    if (!userId || !cleanLabel) return;
    rawCandidates.push({
      user_id: Number(userId),
      baseLabel: cleanLabel,
      avatar_url: avatarUrl || null,
    });
  };

  pushCandidate(user?.id, user?.name, null);

  (profiles || []).forEach((profile) => {
    pushCandidate(profile.owner_user_id, profile.full_name, profile.avatar_url || null);
  });

  Object.values(groupCaregivers || {}).forEach((group) => {
    (group || []).forEach((caregiver) => {
      pushCandidate(
        caregiver.user_id,
        caregiver.user_name || caregiver.user_email || `Usuario ${caregiver.user_id}`,
        caregiver.user_avatar_url || null,
      );
    });
  });

  (posts || []).forEach((post) => {
    pushCandidate(post.user_id, post.user_name, post.user_avatar_url || null);
    (post.comments || []).forEach((comment) => {
      pushCandidate(comment.user_id, comment.user_name, comment.user_avatar_url || null);
    });
  });

  const grouped = rawCandidates.reduce((acc, candidate) => {
    const key = String(candidate.user_id);
    if (!acc[key]) acc[key] = candidate;
    return acc;
  }, {});

  const duplicateCounts = rawCandidates.reduce((acc, candidate) => {
    const key = candidate.baseLabel.toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return Object.values(grouped)
    .map((candidate) => {
      const duplicateKey = candidate.baseLabel.toLowerCase();
      return {
        ...candidate,
        label:
          duplicateCounts[duplicateKey] > 1
            ? `${candidate.baseLabel} ${candidate.user_id}`
            : candidate.baseLabel,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));
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

function CommentThreadItem({
  comment,
  currentUserId,
  postId,
  onReply,
  onToggleLike,
  onDeleteComment,
}) {
  return (
    <div className={`kfeed-comment-thread depth-${Math.min(comment.depth || 0, 3)}`}>
      <div className="kfeed-ig-comment">
        <Avatar name={comment.user_name} size={32} avatarUrl={comment.user_avatar_url || null} />
        <div className="kfeed-ig-comment-body">
          <div className="kfeed-ig-comment-line">
            <span className="kfeed-ig-comment-author">{comment.user_name}</span>
            <span className="kfeed-ig-comment-text">{comment.content}</span>
          </div>
          <div className="kfeed-ig-comment-meta">
            <span className="kfeed-ig-comment-time">{timeAgo(comment.created_at)}</span>
            <button
              type="button"
              className="kfeed-ig-comment-reply"
              onClick={() => onReply(comment)}
            >
              Responder
            </button>
            {comment.user_id === currentUserId && (
              <button
                type="button"
                className="kfeed-ig-comment-delete"
                onClick={() => onDeleteComment(postId, comment.id)}
              >
                Eliminar
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`kfeed-ig-comment-heart ${comment.my_like ? "is-active" : ""}`}
          aria-label={comment.my_like ? "Quitar me gusta del comentario" : "Dar me gusta al comentario"}
          onClick={() => onToggleLike(postId, comment.id, comment.my_like)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          {comment.likes_count > 0 && <span>{comment.likes_count}</span>}
        </button>
      </div>
      {(comment.replies || []).length > 0 && (
        <div className="kfeed-comment-replies">
          {comment.replies.map((reply) => (
            <CommentThreadItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              postId={postId}
              onReply={onReply}
              onToggleLike={onToggleLike}
              onDeleteComment={onDeleteComment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentsSection({
  post,
  currentUserId,
  userName,
  mentionCandidates = [],
  onComment,
  onToggleLike,
  onDeleteComment,
}) {
  const [text, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [caretPosition, setCaretPosition] = useState(0);
  const inputRef = useRef(null);
  const commentTree = buildCommentTree(post.comments || []);
  const mentionState = getMentionSearchState(text, caretPosition);
  const filteredMentions = mentionState
    ? mentionCandidates
        .filter((candidate) => candidate.user_id !== currentUserId)
        .filter((candidate) => !mentionState.query || candidate.label.toLowerCase().includes(mentionState.query))
        .slice(0, 5)
    : [];

  const syncCaret = (target) => {
    if (!target) return;
    setCaretPosition(target.selectionStart ?? target.value.length);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setSubmitting(true);
    try {
      await onComment(post.id, {
        content,
        parent_comment_id: replyTo?.id || null,
        mention_user_ids: extractMentionUserIds(content, mentionCandidates),
      });
      setCommentText("");
      setReplyTo(null);
      setCaretPosition(0);
    } finally {
      setSubmitting(false);
    }
  };

  const insertEmoji = (emoji) => {
    setCommentText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const handleReply = (comment) => {
    const replyPrefix = `@${comment.user_name} `;
    setReplyTo(comment);
    setCommentText((prev) => {
      if (!prev.trim()) return replyPrefix;
      return prev.includes(replyPrefix) ? prev : `${replyPrefix}${prev}`;
    });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const length = inputRef.current?.value?.length || 0;
      inputRef.current?.setSelectionRange(length, length);
      setCaretPosition(length);
    });
  };

  const handleMentionSelect = (candidate) => {
    if (!mentionState) return;
    const nextValue = `${text.slice(0, mentionState.start)}@${candidate.label} ${text.slice(mentionState.end)}`;
    setCommentText(nextValue);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const nextCaret = mentionState.start + candidate.label.length + 2;
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
      setCaretPosition(nextCaret);
    });
  };

  return (
    <div className="kfeed-comments-section">
      {(post.comments || []).length > 0 && (
        <div className="kfeed-comments-list">
          {commentTree.map((comment) => (
            <CommentThreadItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              postId={post.id}
              onReply={handleReply}
              onToggleLike={onToggleLike}
              onDeleteComment={onDeleteComment}
            />
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

      <form className="kfeed-comment-composer" onSubmit={handleSubmit}>
        <Avatar name={userName || ""} size={32} />
        <div className="kfeed-comment-compose-shell">
          {replyTo && (
            <div className="kfeed-comment-replying">
              <span>Respondiendo a {replyTo.user_name}</span>
              <button type="button" onClick={() => setReplyTo(null)}>
                Cancelar
              </button>
            </div>
          )}
          <div className="kfeed-comment-input-wrap">
            <input
              ref={inputRef}
              className="kfeed-comment-input"
              placeholder="\u00danete a la conversaci\u00f3n..."
              value={text}
              onChange={(e) => {
                setCommentText(e.target.value);
                syncCaret(e.target);
              }}
              onClick={(e) => syncCaret(e.target)}
              onKeyUp={(e) => syncCaret(e.target)}
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
          {mentionState && filteredMentions.length > 0 && (
            <div className="kfeed-comment-mentions-menu">
              {filteredMentions.map((candidate) => (
                <button
                  key={candidate.user_id}
                  type="button"
                  className="kfeed-comment-mention-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleMentionSelect(candidate)}
                >
                  <Avatar name={candidate.label} size={24} avatarUrl={candidate.avatar_url || null} />
                  <span>@{candidate.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── Media card ───────────────────────────────────────────────────────────────

function isPdf(attachment) {
  return getAttachmentExtension(attachment?.filename) === ".pdf";
}

function isVideo(attachment) {
  const extension = getAttachmentExtension(attachment?.filename);
  return (
    attachment?.attachment_type === "video" ||
    extension === ".mp4" ||
    extension === ".mov" ||
    extension === ".m4v" ||
    extension === ".webm" ||
    extension === ".ogg" ||
    extension === ".ogv"
  );
}

function inferAttachmentType(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  const extension = getAttachmentExtension(file?.name);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"].includes(extension)) return "image";
  if ([".mp4", ".mov", ".m4v", ".webm", ".ogg", ".ogv"].includes(extension)) return "video";
  return "document";
}

function PostMediaCard({ post }) {
  const typeInfo = getPostTypeInfo(post.post_type);
  const images = (post.attachments || []).filter((a) => a.attachment_type === "image");
  const videos = (post.attachments || []).filter((a) => isVideo(a));
  const pdfs   = (post.attachments || []).filter((a) => !isVideo(a) && isPdf(a));
  const otherDocs = (post.attachments || []).filter((a) => a.attachment_type !== "image" && !isVideo(a) && !isPdf(a));
  const hasAny = images.length > 0 || videos.length > 0 || pdfs.length > 0 || otherDocs.length > 0;

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

      {/* Videos inline */}
      {videos.map((video) => (
        <AuthVideo
          key={video.id}
          postId={post.id}
          attachmentId={video.id}
          filename={video.filename}
          previewUrl={video.preview_url || null}
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

function PostCard({
  post,
  currentUserId,
  userName,
  profiles,
  mentionCandidates,
  onEdit,
  onDelete,
  onReact,
  onComment,
  onToggleCommentLike,
  onDeleteComment,
}) {
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
          <div className="kfeed-post-tools">
            <button
              className="kfeed-post-menu-btn kfeed-post-menu-btn--edit"
              type="button"
              onClick={() => onEdit(post)}
              title="Editar"
              aria-label="Editar publicación"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              className="kfeed-post-menu-btn"
              type="button"
              onClick={() => onDelete(post.id)}
              title="Eliminar"
              aria-label="Eliminar publicación"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
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
          mentionCandidates={mentionCandidates}
          onComment={onComment}
          onToggleLike={onToggleCommentLike}
          onDeleteComment={onDeleteComment}
        />
      )}
    </article>
  );
}

// ─── Modal crear post ─────────────────────────────────────────────────────────

const SENSITIVE_POST_TYPES = ["exam_result", "doctor_visit", "medication"];

function CreatePostModal({
  profiles,
  userName,
  onClose,
  onSubmit,
  hasMfa = false,
  mode = "create",
  initialPost = null,
}) {
  const isEdit = mode === "edit";
  const existingAttachmentCount = initialPost?.attachments?.length || 0;
  const [content, setContent] = useState(initialPost?.content || "");
  const [postType, setPostType] = useState(initialPost?.post_type || "general");
  const [profileId, setProfileId] = useState(initialPost?.profile_id || profiles[0]?.id || "");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [mentionIds, setMentionIds] = useState(initialPost?.mention_profile_ids || []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const fileInputRef = useRef(null);

  const isSensitive =
    SENSITIVE_POST_TYPES.includes(postType) ||
    files.length > 0 ||
    (isEdit && existingAttachmentCount > 0);

  const toggleMention = (id) =>
    setMentionIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleFiles = (selected) => {
    const arr = Array.from(selected);
    setFiles(arr);
    const urls = arr.map((f) => ({ name: f.name, url: URL.createObjectURL(f), type: f.type }));
    setPreviews((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return urls; });
  };

  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const doSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const post = await onSubmit({
        content: content.trim(),
        post_type: postType,
        privacy: "family",
        profile_id: Number(profileId),
        linked_document_id: initialPost?.linked_document_id ?? null,
        mention_profile_ids: mentionIds,
      }, files, previews);
      if (post) onClose();
    } catch {
      setError(isEdit ? "No se pudo guardar los cambios. Intenta de nuevo." : "No se pudo publicar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim() && files.length === 0 && existingAttachmentCount === 0) {
      setError("Escribe algo o adjunta un archivo.");
      return;
    }
    if (!profileId) { setError("Selecciona un perfil."); return; }
    if (isSensitive) {
      setStepUpOpen(true);
    } else {
      doSubmit();
    }
  };

  const handleStepUpVerified = () => {
    setStepUpOpen(false);
    doSubmit();
  };

  const selectedProfile = profiles.find((p) => p.id === Number(profileId));
  const otherProfiles = profiles.filter((p) => p.id !== Number(profileId));

  return (
    <div className="kfeed-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kfeed-modal">
        <div className="kfeed-modal-header">
          <h3 className="kfeed-modal-title">{isEdit ? "Editar publicación" : "Crear publicación"}</h3>
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
            placeholder={isEdit ? "Actualiza lo que quieres compartir con tu familia" : "¿Qué quieres compartir con tu familia?"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            autoFocus
          />

          {isEdit && existingAttachmentCount > 0 && (
            <div className="kfeed-modal-helper">
              Los archivos adjuntos actuales se mantienen en esta edición.
            </div>
          )}

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

          {!isEdit && (
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
          )}

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

          {/* Aviso de contenido sensible */}
          {isSensitive && (
            <div className="kfeed-sensitive-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" style={{ flexShrink: 0 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span>
                {isEdit
                  ? "Esta publicación contiene información médica sensible. Se requerirá verificación de identidad antes de guardar los cambios."
                  : "Esta publicación contiene información médica sensible. Se requerirá verificación de identidad antes de publicar."}
              </span>
            </div>
          )}

          {error && <p className="kfeed-modal-error">{error}</p>}

          <div className="kfeed-modal-footer">
            <button
              type="submit"
              className="kfeed-publish-btn"
              disabled={submitting || (!content.trim() && files.length === 0 && existingAttachmentCount === 0)}
            >
              {submitting
                ? (isEdit ? "Guardando..." : "Publicando...")
                : isSensitive
                  ? "Continuar →"
                  : (isEdit ? "Guardar cambios" : "Publicar")}
            </button>
          </div>
        </form>
      </div>

      <StepUpModal
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onVerified={handleStepUpVerified}
        hasMfa={hasMfa}
        actionLabel={isEdit ? "guardar información médica sensible" : "publicar información médica sensible"}
      />
    </div>
  );
}

// ─── Sidebar de familia (desktop) ────────────────────────────────────────────

function familyRoleLabel(role) {
  if (role === "viewer") return "Lector";
  if (role === "caregiver") return "Editor";
  return "Administrador";
}

function FamilySidebar({ user, profiles, groupCaregivers, onAvatarUpload, isOpen = false, onClose }) {
  const ownProfiles = profiles.filter((p) => p.owner_user_id === user?.id);
  const externalProfiles = profiles.filter((p) => p.owner_user_id !== user?.id);

  const primaryProfile = ownProfiles.find((p) => p.is_primary_profile) || ownProfiles[0];

  // Caregivers del propio grupo (excluye al titular)
  const ownCaregivers = primaryProfile
    ? (groupCaregivers[primaryProfile.id] || []).filter(
        (c) =>
          c.status === "accepted" &&
          c.user_id !== user?.id &&
          String(c.relationship_type || "").toLowerCase() !== "self"
      )
    : [];

  // Grupos externos agrupados por owner
  const externalGroupMap = new Map();
  for (const p of externalProfiles) {
    const ownerId = p.owner_user_id;
    if (!externalGroupMap.has(ownerId)) externalGroupMap.set(ownerId, []);
    externalGroupMap.get(ownerId).push(p);
  }
  const externalGroups = Array.from(externalGroupMap.values()).map((group) => {
    const primary = group.find((p) => p.is_primary_profile) || group[0];
    const caregivers = primary
      ? (groupCaregivers[primary.id] || []).filter(
          (c) => c.status === "accepted" && String(c.relationship_type || "").toLowerCase() !== "self"
        )
      : [];
    return { primary, caregivers };
  });

  const totalSize = ownCaregivers.length + (primaryProfile ? 1 : 0);
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
      <div className="kfeed-sidebar-mobile-header">
        <span className="kfeed-sidebar-mobile-title">Grupo familiar</span>
        <button type="button" className="kfeed-sidebar-close-btn" onClick={onClose} aria-label="Cerrar panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="kfeed-sidebar-group-shell">
        {/* ── Encabezado propio ── */}
        <div className="kfeed-sidebar-group-head">
          <div>
            <span className="kfeed-sidebar-group-kicker">KlinipFeed familiar</span>
            <h3 className="kfeed-sidebar-group-title">Grupo familiar</h3>
          </div>
          <span className="kfeed-sidebar-group-count">
            {totalSize} {totalSize === 1 ? "perfil" : "perfiles"}
          </span>
        </div>

        {/* ── Titular propio ── */}
        {primaryProfile ? (
          <div className="kfeed-sidebar-primary-card">
            <div className="kfeed-sidebar-user-row">
              <div className="kfeed-sidebar-avatar-wrap">
                <Avatar name={primaryProfile.full_name || user?.name || ""} size={50} avatarUrl={primaryProfile.avatar_url || null} />
                <button
                  type="button"
                  className="kfeed-sidebar-avatar-edit-btn"
                  title="Cambiar foto del titular"
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
                <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarChange} />
              </div>
              <div className="kfeed-sidebar-user-info">
                <span className="kfeed-sidebar-primary-badge">Titular de la cuenta</span>
                <span className="kfeed-sidebar-username">{primaryProfile.full_name || user?.name || ""}</span>
                <span className="kfeed-sidebar-userprofile">Administrado desde {primaryProfile.full_name || user?.name || "tu cuenta"}</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Familiares del grupo propio (caregivers) ── */}
        <div className="kfeed-sidebar-family-section">
          <div className="kfeed-sidebar-family-header">
            <span>Familiares dentro de este grupo</span>
            <span className="kfeed-sidebar-family-counter">{ownCaregivers.length}</span>
          </div>
          {ownCaregivers.length > 0 ? (
            ownCaregivers.slice(0, 8).map((c) => (
              <CaregiverRow key={c.id} caregiver={c} />
            ))
          ) : (
            <div className="kfeed-sidebar-family-empty">
              <strong>Aún no agregas familiares</strong>
              <span>Invita personas a tu plan para que aparezcan aquí.</span>
            </div>
          )}
        </div>

        {/* ── Grupos externos — mismo diseño ── */}
        {externalGroups.map((group) => (
          <div key={group.primary?.owner_user_id} className="kfeed-sidebar-external-group">
            <div className="kfeed-sidebar-group-head kfeed-sidebar-external-head">
              <div>
                <span className="kfeed-sidebar-group-kicker">Grupo compartido contigo</span>
                <h3 className="kfeed-sidebar-group-title">{group.primary?.full_name || "Grupo familiar"}</h3>
              </div>
              <span className="kfeed-sidebar-group-count">
                {group.caregivers.length + (group.primary ? 1 : 0)}{" "}
                {group.caregivers.length + (group.primary ? 1 : 0) === 1 ? "perfil" : "perfiles"}
              </span>
            </div>

            {group.primary ? (
              <div className="kfeed-sidebar-primary-card">
                <div className="kfeed-sidebar-user-row">
                  <Avatar name={group.primary.full_name} size={50} avatarUrl={group.primary.avatar_url || null} />
                  <div className="kfeed-sidebar-user-info">
                    <span className="kfeed-sidebar-primary-badge">Titular de la cuenta</span>
                    <span className="kfeed-sidebar-username">{group.primary.full_name}</span>
                    <span className="kfeed-sidebar-userprofile">Administrado desde {group.primary.full_name}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="kfeed-sidebar-family-section">
              <div className="kfeed-sidebar-family-header">
                <span>Familiares dentro de este grupo</span>
                <span className="kfeed-sidebar-family-counter">{group.caregivers.length}</span>
              </div>
              {group.caregivers.length > 0 ? (
                group.caregivers.slice(0, 8).map((c) => (
                  <CaregiverRow key={c.id} caregiver={c} />
                ))
              ) : (
                <div className="kfeed-sidebar-family-empty">
                  <span>No hay otros miembros en este grupo.</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function CaregiverRow({ caregiver }) {
  const name = caregiver.user_name || caregiver.user_email || `Usuario #${caregiver.user_id}`;
  return (
    <div className="kfeed-sidebar-member-row">
      <Avatar name={name} size={38} avatarUrl={caregiver.user_avatar_url || null} />
      <div className="kfeed-sidebar-member-info">
        <span className="kfeed-sidebar-member-name">{name}</span>
        <span className="kfeed-sidebar-member-rel">{familyRoleLabel(caregiver.role)}</span>
      </div>
    </div>
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
  const [groupCaregivers, setGroupCaregivers] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
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
      // Cargar caregivers de todos los perfiles primarios para el sidebar
      const primaryProfiles = profs.filter((p) => p.is_primary_profile);
      if (primaryProfiles.length > 0) {
        const results = await Promise.allSettled(
          primaryProfiles.map((p) =>
            getProfileCaregivers(p.id).then((list) => ({ profileId: p.id, list: list || [] }))
          )
        );
        const map = {};
        results.forEach((r) => {
          if (r.status === "fulfilled" && r.value) {
            map[r.value.profileId] = r.value.list;
          }
        });
        setGroupCaregivers(map);
      }
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
        const type = inferAttachmentType(file);
        const att = await uploadPostAttachment(post.id, file, type);
        // Adjuntar preview URL local para mostrar inmediatamente sin re-fetch
        att.preview_url = preview?.url || null;
        post.attachments = [...(post.attachments || []), att];
      }
    }
    setPosts((prev) => [post, ...prev]);
    return post;
  }

  async function handleEdit(payload) {
    if (!editingPost) return null;
    const updated = await updateFeedPost(editingPost.id, payload);
    setPosts((prev) => prev.map((post) => (
      post.id === editingPost.id
        ? { ...post, ...updated }
        : post
    )));
    setEditingPost(null);
    return updated;
  }

  async function handleDelete(postId) {
    if (!window.confirm("¿Eliminar esta publicación?")) return;
    await deleteFeedPost(postId);
    if (editingPost?.id === postId) {
      setEditingPost(null);
    }
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

  async function handleComment(postId, payload) {
    const comment = await addPostComment(postId, payload);
    setPosts((prev) => prev.map((p) =>
      p.id !== postId ? p : { ...p, comments: [...(p.comments || []), comment], comments_count: p.comments_count + 1 }
    ));
  }

  async function handleToggleCommentLike(postId, commentId, isLiked) {
    let response = null;
    if (isLiked) {
      await unlikePostComment(postId, commentId);
      response = { my_like: false };
    } else {
      response = await likePostComment(postId, commentId);
    }

    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      return {
        ...p,
        comments: (p.comments || []).map((comment) => {
          if (comment.id !== commentId) return comment;
          const nextLiked = typeof response?.my_like === "boolean" ? response.my_like : !comment.my_like;
          const nextCount = typeof response?.likes_count === "number"
            ? response.likes_count
            : Math.max(0, (comment.likes_count || 0) + (nextLiked ? 1 : -1));
          return {
            ...comment,
            my_like: nextLiked,
            likes_count: nextCount,
          };
        }),
      };
    }));
  }

  async function handleDeleteComment(postId, commentId) {
    await deletePostComment(postId, commentId);
    setPosts((prev) => prev.map((p) =>
      p.id !== postId ? p : {
        ...p,
        comments: (p.comments || [])
          .filter((c) => c.id !== commentId)
          .map((c) => (
            c.parent_comment_id === commentId
              ? { ...c, parent_comment_id: null }
              : c
          )),
        comments_count: Math.max(0, p.comments_count - 1),
      }
    ));
  }

  const primaryProfile =
    profiles.find((p) => p.is_primary_profile && p.owner_user_id === user?.id) ||
    profiles.find((p) => p.owner_user_id === user?.id) ||
    profiles.find((p) => p.is_primary_profile) ||
    profiles[0];
  const userAvatarUrl = (primaryProfile?.owner_user_id === user?.id ? primaryProfile?.avatar_url : null) || null;
  const mentionCandidates = buildMentionCandidates({
    user,
    profiles,
    groupCaregivers,
    posts,
  });

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
            mentionCandidates={mentionCandidates}
            onEdit={setEditingPost}
            onDelete={handleDelete}
            onReact={handleReact}
            onComment={handleComment}
            onToggleCommentLike={handleToggleCommentLike}
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
            onSubmit={handleCreate}
            hasMfa={!!user?.mfa_enabled}
          />
        )}
        {editingPost && profiles.length > 0 && (
          <CreatePostModal
            profiles={profiles}
            userName={user?.name || ""}
            onClose={() => setEditingPost(null)}
            onSubmit={handleEdit}
            hasMfa={!!user?.mfa_enabled}
            mode="edit"
            initialPost={editingPost}
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
          groupCaregivers={groupCaregivers}
          onAvatarUpload={handleAvatarUpload}
          isOpen={familySidebarOpen}
          onClose={() => setFamilySidebarOpen(false)}
        />
      )}
    </div>
  );
}
