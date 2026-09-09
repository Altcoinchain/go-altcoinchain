import React from 'react';

const Scanlines = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-[100] opacity-10">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary to-transparent animate-pulse"
           style={{
             backgroundSize: '100% 4px',
             backgroundRepeat: 'repeat-y',
             backgroundImage: 'repeating-linear-gradient(0deg, rgba(0, 255, 255, 0.1) 0px, transparent 1px, transparent 2px, rgba(0, 255, 255, 0.1) 3px)',
             animation: 'scanline 8s linear infinite'
           }}>
      </div>
      <style>
        {`
          @keyframes scanline {
            0% { transform: translateY(0); }
            100% { transform: translateY(100%); }
          }
        `}
      </style>
    </div>
  );
};

export default Scanlines;
