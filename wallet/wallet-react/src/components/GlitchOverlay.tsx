import React, { useEffect, useState } from 'react';

const GlitchOverlay = () => {
  const [glitching, setGlitching] = useState(false);

  useEffect(() => {
    const triggerGlitch = () => {
      setGlitching(true);
      setTimeout(() => setGlitching(false), 200);
    };

    // Random glitch every 5-15 seconds
    const scheduleGlitch = () => {
      const delay = Math.random() * 10000 + 5000;
      setTimeout(() => {
        triggerGlitch();
        scheduleGlitch();
      }, delay);
    };

    scheduleGlitch();
  }, []);

  if (!glitching) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[99]">
      {/* Horizontal glitch bars */}
      <div
        className="absolute w-full h-1 bg-primary"
        style={{
          top: `${Math.random() * 100}%`,
          opacity: 0.7,
          animation: 'glitch-slide 0.1s linear infinite'
        }}
      />
      <div
        className="absolute w-full h-1 bg-secondary"
        style={{
          top: `${Math.random() * 100}%`,
          opacity: 0.7,
          animation: 'glitch-slide 0.1s linear infinite reverse'
        }}
      />
      <div
        className="absolute w-full h-2 bg-accent"
        style={{
          top: `${Math.random() * 100}%`,
          opacity: 0.5,
          animation: 'glitch-slide 0.15s linear infinite'
        }}
      />

      <style>
        {`
          @keyframes glitch-slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}
      </style>
    </div>
  );
};

export default GlitchOverlay;
