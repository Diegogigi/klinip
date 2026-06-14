const MOJIBAKE_PATTERN = /(?:\u00c3.|\u00c2.|\u00e2.|\u00f0.|\u00ef.|\ufffd)/;

const FALLBACKS = [
  ["\u00c3\u00a1", "\u00e1"],
  ["\u00c3\u00a9", "\u00e9"],
  ["\u00c3\u00ad", "\u00ed"],
  ["\u00c3\u00b3", "\u00f3"],
  ["\u00c3\u00ba", "\u00fa"],
  ["\u00c3\u00b1", "\u00f1"],
  ["\u00c3\u00bc", "\u00fc"],
  ["\u00c3\u0081", "\u00c1"],
  ["\u00c3\u0089", "\u00c9"],
  ["\u00c3\u008d", "\u00cd"],
  ["\u00c3\u0093", "\u00d3"],
  ["\u00c3\u009a", "\u00da"],
  ["\u00c3\u0091", "\u00d1"],
  ["\u00c2\u00bf", "\u00bf"],
  ["\u00c2\u00a1", "\u00a1"],
  ["\u00c2\u00b7", "\u00b7"],
  ["\u00c2\u00b0", "\u00b0"],
  ["\u00c2\u00a9", "\u00a9"],
  ["\u00c3\u0097", "\u00d7"],
  ["\u00e2\u0080\u0098", "'"],
  ["\u00e2\u0080\u0099", "'"],
  ["\u00e2\u0080\u009c", '"'],
  ["\u00e2\u0080\u009d", '"'],
  ["\u00e2\u0080\u0093", "-"],
  ["\u00e2\u0080\u0094", "-"],
  ["\u00e2\u0080\u00a6", "..."],
  ["\u00e2\u0080\u00a2", "\u2022"],
];

export function repairMojibakeText(value) {
  let text = String(value ?? "");
  if (!text || !MOJIBAKE_PATTERN.test(text)) return text;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let next = text;

    if (typeof TextDecoder !== "undefined") {
      try {
        const bytes = Uint8Array.from(next, (char) => char.charCodeAt(0) & 0xff);
        const decoded = new TextDecoder("utf-8").decode(bytes);
        if (decoded && !decoded.includes("\u0000")) {
          next = decoded;
        }
      } catch {
        // Fallback replacements below cover the common mojibake cases.
      }
    }

    next = FALLBACKS.reduce(
      (result, [search, replacement]) => result.split(search).join(replacement),
      next
    );

    if (next === text) break;
    text = next;
    if (!MOJIBAKE_PATTERN.test(text)) break;
  }

  return text;
}

export function cleanUiText(value, fallback = "") {
  const cleaned = repairMojibakeText(value).trim();
  return cleaned || fallback;
}

const REPAIRABLE_ATTRIBUTES = ["aria-label", "placeholder", "title"];

function repairElementAttributes(element) {
  if (!(element instanceof Element)) return;
  REPAIRABLE_ATTRIBUTES.forEach((attributeName) => {
    const current = element.getAttribute(attributeName);
    if (!current) return;
    const repaired = repairMojibakeText(current);
    if (repaired !== current) {
      element.setAttribute(attributeName, repaired);
    }
  });
}

function repairNodeTree(node) {
  if (!node) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const current = node.nodeValue || "";
    const repaired = repairMojibakeText(current);
    if (repaired !== current) {
      node.nodeValue = repaired;
    }
    return;
  }

  if (!(node instanceof Element)) return;

  repairElementAttributes(node);

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const current = textNode.nodeValue || "";
    const repaired = repairMojibakeText(current);
    if (repaired !== current) {
      textNode.nodeValue = repaired;
    }
    textNode = walker.nextNode();
  }

  node.querySelectorAll("*").forEach((child) => {
    repairElementAttributes(child);
  });
}

export function observeMojibakeRepair(root) {
  if (typeof document === "undefined" || !root) return () => {};

  repairNodeTree(root);

  if (typeof MutationObserver === "undefined") {
    return () => {};
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "characterData") {
        repairNodeTree(mutation.target);
        return;
      }

      if (mutation.type === "attributes") {
        repairNodeTree(mutation.target);
        return;
      }

      mutation.addedNodes.forEach((node) => {
        repairNodeTree(node);
      });
    });
  });

  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: REPAIRABLE_ATTRIBUTES,
  });

  return () => observer.disconnect();
}
