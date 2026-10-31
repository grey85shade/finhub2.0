import React, { useRef, useState, useEffect } from 'react';
import './Dock.css';

/**
 * Dock Component inspirado en React Bits (macOS Dock style)
 * Totalmente estático, sin dependencias externas pesadas, compatible con Synology & Vite.
 *
 * @param {Array} items - Lista de objetos { id, label, icon: ReactNode, onClick }
 * @param {string} activeId - ID del ítem activo
 * @param {number} panelHeight - Altura base del dock (default: 44)
 * @param {number} baseItemSize - Tamaño estándar de cada icono (default: 34)
 * @param {number} magnification - Tamaño máximo al hacer hover directo (default: 54)
 * @param {number} distance - Radio de influencia del cursor en px (default: 150)
 * @param {number} roundness - Radio de curvatura border-radius proporcional (default: 0.6)
 */
export default function Dock({
  items = [],
  activeId = 'inicio',
  onSelect,
  panelHeight = 44,
  baseItemSize = 34,
  magnification = 54,
  distance = 150,
  roundness = 0.6,
  className = ''
}) {
  const dockRef = useRef(null);
  const [mouseX, setMouseX] = useState(null);

  const handleMouseMove = (e) => {
    if (dockRef.current) {
      const rect = dockRef.current.getBoundingClientRect();
      setMouseX(e.clientX - rect.left);
    }
  };

  const handleMouseLeave = () => {
    setMouseX(null);
  };

  return (
    <nav className={`dock-wrapper ${className}`}>
      <div
        ref={dockRef}
        className="dock-panel"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          height: `${panelHeight}px`,
          borderRadius: `${panelHeight * roundness}px`,
        }}
        role="toolbar"
        aria-label="Barra de navegación principal"
      >
        {items.map((item) => (
          <DockItem
            key={item.id}
            item={item}
            isActive={activeId === item.id}
            onClick={() => onSelect?.(item.id)}
            mouseX={mouseX}
            baseSize={baseItemSize}
            magnification={magnification}
            distance={distance}
          />
        ))}
      </div>
    </nav>
  );
}

function DockItem({
  item,
  isActive,
  onClick,
  mouseX,
  baseSize,
  magnification,
  distance
}) {
  const itemRef = useRef(null);
  const [size, setSize] = useState(baseSize);

  useEffect(() => {
    if (mouseX === null || !itemRef.current) {
      setSize(baseSize);
      return;
    }

    const rect = itemRef.current.getBoundingClientRect();
    const parentRect = itemRef.current.parentElement.getBoundingClientRect();
    const itemCenter = rect.left - parentRect.left + rect.width / 2;
    const dist = Math.abs(mouseX - itemCenter);

    if (dist < distance) {
      // Función gaussiana / coseno suave para cálculo fluido tipo macOS
      const factor = Math.cos((dist / distance) * (Math.PI / 2));
      const calculatedSize = baseSize + (magnification - baseSize) * factor;
      setSize(calculatedSize);
    } else {
      setSize(baseSize);
    }
  }, [mouseX, baseSize, magnification, distance]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`dock-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
      aria-label={item.label}
    >
      <div className="dock-icon-wrapper">
        {React.cloneElement(item.icon, {
          size: Math.round(size * 0.52),
          className: 'dock-icon'
        })}
      </div>
      <span className="dock-tooltip">{item.label}</span>
      {isActive && <span className="dock-active-dot" />}
    </button>
  );
}
