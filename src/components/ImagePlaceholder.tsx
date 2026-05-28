const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div
    className={`w-full ${aspectRatio} rounded-2xl`}
    style={{
      background:
        'linear-gradient(90deg, var(--skeleton-color) 25%, var(--skeleton-highlight) 50%, var(--skeleton-color) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shine 1.5s infinite',
      boxShadow: 'inset 0 0 0 1px var(--app-line)',
    }}
  >
    <style>{`
      @keyframes shine {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
    `}</style>
  </div>
);

export { ImagePlaceholder };
