"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

export interface CarouselItem {
  id: string;
  tag: string;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
}

export interface CircularCarouselProps {
  items: CarouselItem[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
  className?: string;
}

const VISIBLE_COUNT = 5;
const MAX_RADIUS_X = 230;
const RADIUS_Y = 85;

function getItemPosition(index: number, activeIndex: number, total: number, radiusX: number) {
  const half = Math.floor(VISIBLE_COUNT / 2);
  let offset = index - activeIndex;
  if (offset > half) offset -= total;
  if (offset < -half) offset += total;
  if (Math.abs(offset) > half) return null;

  const angle = (offset / VISIBLE_COUNT) * Math.PI;
  const x = Math.sin(angle) * radiusX;
  const y = RADIUS_Y - Math.cos(angle) * RADIUS_Y;
  const distance = Math.abs(offset);
  const scale = Math.max(0, 1 - (distance / (half + 1)) * 0.3);
  const opacity = Math.max(0.35, 1 - (distance / (half + 1)) * 0.65);
  const zIndex = VISIBLE_COUNT - distance;
  return { x, y, scale, opacity, zIndex };
}

/** Plain-CSS circular case browser — no Tailwind/framer-motion/lucide, matches the existing NEXUS design tokens. */
export function CircularCarousel({ items, autoPlay = true, autoPlayInterval = 4500, className }: CircularCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [radiusX, setRadiusX] = useState(MAX_RADIUS_X);
  const total = items.length;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const cardHalfWidth = width <= 680 ? 95 : 115; // matches the card widths set in globals.css at the same breakpoint
      setRadiusX(Math.max(40, Math.min(MAX_RADIUS_X, width / 2 - cardHalfWidth - 12)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goTo = useCallback((index: number) => setActiveIndex(((index % total) + total) % total), [total]);
  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  useEffect(() => {
    if (!autoPlay || isHovered || isFocused || total < 2) return;
    const id = setInterval(next, autoPlayInterval);
    return () => clearInterval(id);
  }, [autoPlay, autoPlayInterval, isHovered, isFocused, next, total]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") prev();
      if (event.key === "ArrowRight") next();
    };
    const el = containerRef.current;
    el?.addEventListener("keydown", handler);
    return () => el?.removeEventListener("keydown", handler);
  }, [next, prev]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label="Prepared investigations"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      className={`case-carousel ${className ?? ""}`}
    >
      <div className="case-carousel-track">
        {items.map((item, index) => {
          const position = getItemPosition(index, activeIndex, total, radiusX);
          if (!position) return null;
          const isActive = index === activeIndex;
          const style = { "--x": `${position.x}px`, "--y": `${position.y}px`, "--scale": position.scale, opacity: position.opacity, zIndex: position.zIndex } as CSSProperties;
          const body = <>
            <span className="case-carousel-tag">{item.tag}</span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            {isActive && <b>{item.ctaLabel} →</b>}
          </>;
          return isActive
            ? <a key={item.id} href={item.href} style={style} className="case-carousel-card active" aria-current="true">{body}</a>
            : <button key={item.id} type="button" onClick={() => goTo(index)} style={style} className="case-carousel-card" aria-label={`Show ${item.title}`}>{body}</button>;
        })}
      </div>
      <div className="case-carousel-controls">
        <button type="button" onClick={prev} aria-label="Previous case" className="case-carousel-nav">‹</button>
        <div className="case-carousel-dots" role="tablist">
          {items.map((item, index) => (
            <button key={item.id} type="button" role="tab" aria-selected={index === activeIndex} aria-label={`Go to ${item.title}`} onClick={() => goTo(index)} className={index === activeIndex ? "active" : ""} />
          ))}
        </div>
        <button type="button" onClick={next} aria-label="Next case" className="case-carousel-nav">›</button>
      </div>
    </div>
  );
}

export default CircularCarousel;
