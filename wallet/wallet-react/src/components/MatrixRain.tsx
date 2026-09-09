import React, { useEffect, useRef } from 'react';

interface MatrixRainProps {
  enabled?: boolean;
  darkMode?: boolean;
}

const MatrixRain: React.FC<MatrixRainProps> = ({ enabled = true, darkMode = true }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const hexChars = '0123456789abcdef';
    // "Altcoinchain  R.I.P. altcoincash <3" in hex
    const specialMessage = '416c74636f696e636861696e2020522e492e502e20616c74636f696e63617368203c33';
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);

    const drops: number[] = [];
    const messageColumns: { char: string; index: number }[] = [];

    // Initialize drops
    for (let i = 0; i < columns; i++) {
      drops[i] = Math.random() * -100;
    }

    // Randomly assign message characters to some columns
    const messageChars = specialMessage.split('');
    let msgIndex = 0;
    for (let i = 0; i < columns && msgIndex < messageChars.length; i++) {
      if (Math.random() > 0.7) {
        messageColumns.push({ char: messageChars[msgIndex], index: i });
        msgIndex++;
      }
    }

    const draw = () => {
      // Background fade
      if (darkMode) {
        ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
      } else {
        ctx.fillStyle = 'rgba(245, 245, 245, 0.1)';
      }
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Check if this column should show a message character
        const msgCol = messageColumns.find(m => m.index === i);
        let text: string;
        let isSpecial = false;

        if (msgCol && Math.random() > 0.92) {
          text = msgCol.char;
          isSpecial = true;
        } else {
          text = hexChars[Math.floor(Math.random() * hexChars.length)];
        }

        // Color based on mode and whether it's a special character
        if (isSpecial) {
          // Special message chars in magenta/pink
          ctx.fillStyle = darkMode
            ? `rgba(255, 0, 255, ${Math.random() * 0.5 + 0.5})`
            : `rgba(200, 0, 200, ${Math.random() * 0.5 + 0.5})`;
        } else {
          // Regular hex in cyan/green
          ctx.fillStyle = darkMode
            ? `rgba(0, 255, 255, ${Math.random() * 0.5 + 0.5})`
            : `rgba(0, 150, 150, ${Math.random() * 0.5 + 0.5})`;
        }

        ctx.fillText(text, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }

        drops[i]++;
      }
    };

    const interval = setInterval(draw, 50);

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, [enabled, darkMode]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[5] opacity-30"
    />
  );
};

export default MatrixRain;
