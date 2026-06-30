import React, { useState, useEffect, useRef } from 'react';
import type { TouchEvent } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';

interface ImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ src, alt, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const stateRef = useRef({
    scale: 1,
    position: { x: 0, y: 0 },
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    lastTouchTime: 0,
    pinchStartDist: 0,
    pinchStartScale: 1,
    swipeStartY: 0,
    isSwipingDown: false,
  });

  // Keep stateRef in sync with React state for event handlers
  useEffect(() => {
    stateRef.current.scale = scale;
    stateRef.current.position = position;
  }, [scale, position]);

  const handleDoubleTap = (clientX: number, clientY: number) => {
    if (stateRef.current.scale > 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
      const newScale = 2.5;
      setScale(newScale);
      
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const offsetX = clientX - (rect.left + rect.width / 2);
        const offsetY = clientY - (rect.top + rect.height / 2);
        
        setPosition({
          x: -offsetX * (newScale - 1),
          y: -offsetY * (newScale - 1)
        });
      }
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const now = Date.now();
      
      // Double tap check
      if (now - stateRef.current.lastTouchTime < 300) {
        e.preventDefault();
        handleDoubleTap(touch.clientX, touch.clientY);
        stateRef.current.lastTouchTime = 0;
        return;
      }
      stateRef.current.lastTouchTime = now;

      if (stateRef.current.scale > 1) {
        stateRef.current.isDragging = true;
        stateRef.current.dragStart = {
          x: touch.clientX - stateRef.current.position.x,
          y: touch.clientY - stateRef.current.position.y
        };
      } else {
        stateRef.current.swipeStartY = touch.clientY;
        stateRef.current.isSwipingDown = true;
      }
    } else if (e.touches.length === 2) {
      e.preventDefault();
      stateRef.current.isDragging = false;
      stateRef.current.isSwipingDown = false;
      
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      stateRef.current.pinchStartDist = dist;
      stateRef.current.pinchStartScale = stateRef.current.scale;
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      
      if (stateRef.current.isDragging && stateRef.current.scale > 1) {
        const nextX = touch.clientX - stateRef.current.dragStart.x;
        const nextY = touch.clientY - stateRef.current.dragStart.y;
        setPosition({ x: nextX, y: nextY });
      } else if (stateRef.current.isSwipingDown) {
        const diffY = touch.clientY - stateRef.current.swipeStartY;
        if (diffY > 0) {
          if (containerRef.current) {
            containerRef.current.style.transform = `translateY(${diffY}px)`;
            containerRef.current.style.opacity = `${Math.max(0.3, 1 - diffY / 400)}`;
          }
        }
      }
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / stateRef.current.pinchStartDist;
      const nextScale = Math.max(1, Math.min(6, stateRef.current.pinchStartScale * ratio));
      setScale(nextScale);
      
      if (nextScale === 1) {
        setPosition({ x: 0, y: 0 });
      }
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (stateRef.current.isSwipingDown) {
      if (containerRef.current) {
        const touch = e.changedTouches[0];
        const diffY = touch.clientY - stateRef.current.swipeStartY;
        
        if (diffY > 150) {
          onClose();
        } else {
          containerRef.current.style.transition = 'all 0.2s ease';
          containerRef.current.style.transform = 'translateY(0)';
          containerRef.current.style.opacity = '1';
          setTimeout(() => {
            if (containerRef.current) containerRef.current.style.transition = '';
          }, 200);
        }
      }
      stateRef.current.isSwipingDown = false;
    }
    stateRef.current.isDragging = false;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      e.preventDefault();
      stateRef.current.isDragging = true;
      stateRef.current.dragStart = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (stateRef.current.isDragging && scale > 1) {
      setPosition({
        x: e.clientX - stateRef.current.dragStart.x,
        y: e.clientY - stateRef.current.dragStart.y
      });
    }
  };

  const onMouseUp = () => {
    stateRef.current.isDragging = false;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="image-viewer-portal">
      <div className="image-viewer-backdrop" onClick={onClose} />
      
      <div 
        ref={containerRef}
        className="image-viewer-container"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || 'Full screen preview'}
          className="image-viewer-content"
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
            transition: stateRef.current.isDragging || stateRef.current.isSwipingDown ? 'none' : 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            maxWidth: '95vw',
            maxHeight: '90vh',
            objectFit: 'contain',
            userSelect: 'none'
          }}
          draggable={false}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
        />
      </div>

      <div className="image-viewer-controls">
        <button className="viewer-control-btn" onClick={() => setScale(s => Math.max(1, s - 0.5))} disabled={scale <= 1}>
          <ZoomOut size={20} />
        </button>
        <button className="viewer-control-btn" onClick={() => setScale(s => Math.min(6, s + 0.5))}>
          <ZoomIn size={20} />
        </button>
        <button className="viewer-control-btn" onClick={() => setRotation(r => (r + 90) % 360)}>
          <RotateCw size={18} />
        </button>
        <button className="viewer-control-btn close-btn" onClick={onClose} aria-label="Close viewer">
          <X size={20} />
        </button>
      </div>
    </div>
  );
};
