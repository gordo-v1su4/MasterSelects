import { useCallback, useRef } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard, selectActiveBoardNodes } from '../../../stores/flashboardStore/selectors';
import { FlashBoardNode } from './FlashBoardNode';

export function FlashBoardCanvas() {
  const board = useFlashBoardStore(selectActiveBoard);
  const nodes = useFlashBoardStore(selectActiveBoardNodes);
  const selectedNodeIds = useFlashBoardStore((s) => s.selectedNodeIds);
  const clearSelection = useFlashBoardStore((s) => s.clearSelection);
  const updateViewport = useFlashBoardStore((s) => s.updateViewport);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const zoom = board?.viewport.zoom ?? 1;
  const panX = board?.viewport.panX ?? 0;
  const panY = board?.viewport.panY ?? 0;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!board) return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, board.viewport.zoom * delta));

    // Zoom toward cursor position
    const rect = e.currentTarget.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const newPanX = cursorX - (cursorX - board.viewport.panX) * (newZoom / board.viewport.zoom);
    const newPanY = cursorY - (cursorY - board.viewport.panY) * (newZoom / board.viewport.zoom);

    updateViewport(board.id, { zoom: newZoom, panX: newPanX, panY: newPanY });
  }, [board, updateViewport]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Left-click on background = deselect + start pan; middle-click = pan only
    if (e.button === 0) {
      clearSelection();
    }
    if (e.button === 0 || e.button === 1) {
      if (!board) return;
      isPanning.current = true;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: board.viewport.panX,
        panY: board.viewport.panY,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isPanning.current || !board) return;
        const dx = ev.clientX - panStart.current.x;
        const dy = ev.clientY - panStart.current.y;
        updateViewport(board.id, {
          panX: panStart.current.panX + dx,
          panY: panStart.current.panY + dy,
        });
      };

      const handleMouseUp = () => {
        isPanning.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
  }, [board, clearSelection, updateViewport]);

  const selectedSet = new Set(selectedNodeIds);

  return (
    <div
      className="flashboard-canvas"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
    >
      <div
        className="flashboard-canvas-inner"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
      >
        {nodes.map((node) => (
          <FlashBoardNode
            key={node.id}
            node={node}
            isSelected={selectedSet.has(node.id)}
            zoom={zoom}
          />
        ))}
      </div>
    </div>
  );
}
