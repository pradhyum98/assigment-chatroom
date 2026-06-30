import React, { useState, useEffect, useRef } from 'react';
import type { TouchEvent } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw, Download, Share2, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageViewerProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ images, initialIndex, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
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
    swipeStartX: 0,
    isSwipingDown: false,
    isSwipingSides: false,
  });

  // Reset scale and rotation when changing images
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  }, [currentIndex]);

  // Sync stateRef
  useEffect(() => {
    stateRef.current.scale = scale;
    stateRef.current.position = position;
  }, [scale, position]);

  // Image preloading for adjacent images
  useEffect(() => {
    if (images.length === 0) return;
    
    // Preload previous image
    if (currentIndex > 0) {
      const imgPrev = new Image();
      imgPrev.src = images[currentIndex - 1];
    }
    
    // Preload next image
    if (currentIndex < images.length - 1) {
      const imgNext = new Image();
      imgNext.src = images[currentIndex + 1];
    }
  }, [currentIndex, images]);

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
        stateRef.current.swipeStartX = touch.clientX;
        stateRef.current.isSwipingDown = false;
        stateRef.current.isSwipingSides = false;
      }
    } else if (e.touches.length === 2) {
      e.preventDefault();
      stateRef.current.isDragging = false;
      stateRef.current.isSwipingDown = false;
      stateRef.current.isSwipingSides = false;
      
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
      } else if (stateRef.current.scale === 1) {
        const diffY = touch.clientY - stateRef.current.swipeStartY;
        const diffX = touch.clientX - stateRef.current.swipeStartX;
        
        // Determine swipe direction if not already set
        if (!stateRef.current.isSwipingDown && !stateRef.current.isSwipingSides) {
          if (Math.abs(diffY) > Math.abs(diffX) && diffY > 10) {
            stateRef.current.isSwipingDown = true;
          } else if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
            stateRef.current.isSwipingSides = true;
          }
        }

        if (stateRef.current.isSwipingDown) {
          if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(0, ${diffY}px, 0)`;
            containerRef.current.style.opacity = `${Math.max(0.3, 1 - diffY / 400)}`;
          }
        } else if (stateRef.current.isSwipingSides) {
          if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(${diffX}px, 0, 0)`;
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
      const touch = e.changedTouches[0];
      const diffY = touch.clientY - stateRef.current.swipeStartY;
      
      if (diffY > 150) {
        onClose();
      } else {
        resetContainerStyle();
      }
      stateRef.current.isSwipingDown = false;
    } else if (stateRef.current.isSwipingSides) {
      const touch = e.changedTouches[0];
      const diffX = touch.clientX - stateRef.current.swipeStartX;
      
      if (diffX > 80 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      } else if (diffX < -80 && currentIndex < images.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
      resetContainerStyle();
      stateRef.current.isSwipingSides = false;
    }
    stateRef.current.isDragging = false;
  };

  const resetContainerStyle = () => {
    if (containerRef.current) {
      containerRef.current.style.transition = 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      containerRef.current.style.transform = 'translate3d(0, 0, 0)';
      containerRef.current.style.opacity = '1';
      setTimeout(() => {
        if (containerRef.current) containerRef.current.style.transition = '';
      }, 200);
    }
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

  const handleDownload = async () => {
    const url = images[currentIndex];
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `media_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  const handleShare = async () => {
    const url = images[currentIndex];
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Shared Media',
          url: url
        });
      } catch (err) {
        console.error('Error sharing link:', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert('Media link copied to clipboard!');
      } catch (err) {
        console.error('Copy to clipboard failed:', err);
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, images, onClose]);

  const activeSrc = images[currentIndex] || '';

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
          src={activeSrc}
          alt={`Full screen preview ${currentIndex + 1} of ${images.length}`}
          className="image-viewer-content"
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
            transition: stateRef.current.isDragging || stateRef.current.isSwipingDown || stateRef.current.isSwipingSides ? 'none' : 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            maxWidth: '95vw',
            maxHeight: '90vh',
            objectFit: 'contain',
            userSelect: 'none',
          }}
          draggable={false}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
        />
      </div>

      {currentIndex > 0 && (
        <button 
          className="viewer-nav-btn prev-btn" 
          onClick={() => setCurrentIndex(currentIndex - 1)}
          aria-label="Previous image"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {currentIndex < images.length - 1 && (
        <button 
          className="viewer-nav-btn next-btn" 
          onClick={() => setCurrentIndex(currentIndex + 1)}
          aria-label="Next image"
        >
          <ChevronRight size={24} />
        </button>
      )}

      <div className="image-viewer-controls">
        <button className="viewer-control-btn" onClick={handleShare} title="Share media">
          <Share2 size={18} />
        </button>
        <button className="viewer-control-btn" onClick={handleDownload} title="Download media">
          <Download size={18} />
        </button>
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
      
      <div className="viewer-counter-badge">
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );
};
