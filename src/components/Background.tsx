import { useEffect, useRef } from 'react';

class Particle {
  x = 0;
  y = 0;
  size = 0;
  speedX = 0;
  speedY = 0;
  opacity = 0;
  opacitySpeed = 0;
  twinkle = false;
  twinkleSpeed = 0;
  twinkleOffset = 0;
  color = '';
  canvasWidth: number;
  canvasHeight: number;

  constructor(canvasWidth: number, canvasHeight: number) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.reset(true);
  }

  reset(initial = false) {
    this.x = Math.random() * this.canvasWidth;
    this.y = initial ? Math.random() * this.canvasHeight : this.canvasHeight + 10;
    this.size = Math.random() * 2 + 0.3;
    this.speedY = -(Math.random() * 0.4 + 0.1);
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.opacity = Math.random() * 0.6 + 0.1;
    this.opacitySpeed = (Math.random() * 0.005 + 0.002) * (Math.random() > 0.5 ? 1 : -1);
    this.twinkle = Math.random() > 0.6;
    this.twinkleSpeed = Math.random() * 0.03 + 0.01;
    this.twinkleOffset = Math.random() * Math.PI * 2;
    const gold = Math.random() > 0.25;
    if (gold) {
      const r = Math.floor(180 + Math.random() * 71);
      const g = Math.floor(130 + Math.random() * 60);
      const b = Math.floor(20 + Math.random() * 40);
      this.color = `rgb(${r},${g},${b})`;
    } else {
      this.color = `rgb(${Math.floor(120 + Math.random() * 60)},${Math.floor(20 + Math.random() * 30)},20)`;
    }
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.opacity += this.opacitySpeed;
    if (this.opacity > 0.8 || this.opacity < 0.05) this.opacitySpeed *= -1;
    if (this.y < -10) this.reset();
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    let op = this.opacity;
    if (this.twinkle) op *= 0.5 + 0.5 * Math.sin(t * this.twinkleSpeed + this.twinkleOffset);
    ctx.save();
    ctx.globalAlpha = op;
    ctx.fillStyle = this.color;
    if (this.size > 1.5) {
      ctx.shadowBlur = 6;
      ctx.shadowColor = this.color;
    }
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export default function Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: Particle[] = [];
    let rafId = 0;

    function resizeCanvas() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function initParticles() {
      if (!canvas) return;
      particles = [];
      const count = Math.min(Math.floor((canvas.width * canvas.height) / 6000), 180);
      for (let i = 0; i < count; i++) particles.push(new Particle(canvas.width, canvas.height));
    }

    function animate(t = 0) {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.canvasWidth = canvas.width;
        p.canvasHeight = canvas.height;
        p.update();
        p.draw(ctx, t);
      });
      rafId = requestAnimationFrame(animate);
    }

    function handleResize() {
      resizeCanvas();
      initParticles();
    }

    resizeCanvas();
    initParticles();
    rafId = requestAnimationFrame(animate);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <>
      <canvas id="particle-canvas" ref={canvasRef} />
      <div className="ink-blob ink-blob-1" />
      <div className="ink-blob ink-blob-2" />
      <div className="ink-blob ink-blob-3" />
    </>
  );
}
