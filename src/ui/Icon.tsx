const paths: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bag: 'M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2',
  task: 'M4 6h2m4 0h10M4 12h2m4 0h10M4 18h2m4 0h10',
  wallet: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3M3 7.5V18a2 2 0 0 0 2 2h15V8H5.5A2.5 2.5 0 0 1 3 7.5ZM16 14h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z',
  up: 'M12 19V5m-6 6 6-6 6 6',
  down: 'M12 5v14m6-6-6 6-6-6',
  sync: 'M20 11a8 8 0 0 0-14.5-4.5M4 4v3h3m-3 6a8 8 0 0 0 14.5 4.5M20 20v-3h-3',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4h4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4m5-1v5l3 2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sort: 'M8 4v16m0 0-4-4m4 4 4-4M16 20V4m0 0-4 4m4-4 4 4',
  cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  upload: 'M12 20V9m-5 5 5-5 5 5M5 4h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01',
  calendar: 'M4 7h16v13H4V7Zm0 4h16M8 3v4m8-4v4',
  play: 'M7 5v14l12-7L7 5Z',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
};

export function Icon({ name, size = 24, title }: { name: keyof typeof paths | string; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}
