/**
 * Limpia los caches de la PWA que empiezan con "klinip-cache".
 */
export async function clearAppCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("klinip-cache"))
      .map((key) => caches.delete(key))
  );
}
