import { useState } from "react";
import { platform } from "../platform/ipc";

type Props = { id: string; title: string };

/** Thumbnail first; the privacy-enhanced player mounts only on click (plan §9.6). */
export function YouTubeLite({ id, title }: Props) {
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="w-full max-w-xl overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
      <div className="relative aspect-video bg-stone-900">
        {playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`}
            title={title}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="group absolute inset-0 h-full w-full"
            onClick={() => setPlaying(true)}
            aria-label={`Play video: ${title}`}
          >
            <img
              src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
            />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600 px-5 py-3 text-xl text-white shadow-lg">
              ▶
            </span>
          </button>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-2 p-3 text-sm">
        <span className="truncate">{title}</span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100"
          onClick={() => void platform.openUrl(`https://www.youtube.com/watch?v=${id}`)}
        >
          Open on YouTube
        </button>
      </figcaption>
    </figure>
  );
}
