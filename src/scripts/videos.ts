// Vídeo só carrega perto da tela e só toca enquanto está visível.
export function initVideos() {
  const videos = document.querySelectorAll<HTMLVideoElement>('video[data-src]');
  if (!videos.length) return;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        const video = target as HTMLVideoElement;
        if (!isIntersecting) {
          video.pause();
          continue;
        }
        if (!video.poster) video.poster = video.dataset.poster!;
        if (still) continue;
        if (!video.src) video.src = video.dataset.src!;
        video.play().catch(() => {});
      }
    },
    { rootMargin: '30% 0px' },
  );

  videos.forEach((video) => observer.observe(video));
}
