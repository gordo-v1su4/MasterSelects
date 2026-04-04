import { useCallback, useRef } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardNode as FlashBoardNodeType } from '../../../stores/flashboardStore/types';

interface FlashBoardNodeProps {
  node: FlashBoardNodeType;
  isSelected: boolean;
  zoom: number;
}

export function FlashBoardNode({ node, isSelected, zoom }: FlashBoardNodeProps) {
  const moveNode = useFlashBoardStore((s) => s.moveNode);
  const setSelectedNodes = useFlashBoardStore((s) => s.setSelectedNodes);
  const openComposer = useFlashBoardStore((s) => s.openComposer);

  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);

  const status = node.job?.status ?? 'draft';
  const prompt = node.request?.prompt;
  const provider = node.request?.providerId;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    setSelectedNodes([node.id]);

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.position.x,
      nodeY: node.position.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - dragRef.current.startX) / zoom;
      const dy = (ev.clientY - dragRef.current.startY) / zoom;
      moveNode(node.id, {
        x: dragRef.current.nodeX + dx,
        y: dragRef.current.nodeY + dy,
      });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [node.id, node.position.x, node.position.y, zoom, moveNode, setSelectedNodes]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    openComposer(node.id);
  }, [node.id, openComposer]);

  return (
    <div
      className={`flashboard-node ${status} ${isSelected ? 'selected' : ''}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flashboard-node-status" />
      <div className="flashboard-node-body">
        {node.result && (
          <div className="flashboard-node-preview">
            {/* Thumbnail preview for completed nodes — media lookup handled by Agent D */}
          </div>
        )}
        <div className={`flashboard-node-prompt ${!prompt ? 'empty' : ''}`}>
          {prompt || 'No prompt yet'}
        </div>
        {provider && (
          <div className="flashboard-node-provider">{provider}</div>
        )}
        {status === 'processing' && node.job?.progress != null && (
          <div className="flashboard-node-progress">
            <div
              className="flashboard-node-progress-bar"
              style={{ width: `${Math.round(node.job.progress * 100)}%` }}
            />
          </div>
        )}
        {status === 'failed' && node.job?.error && (
          <div className="flashboard-node-error" title={node.job.error}>
            {node.job.error}
          </div>
        )}
      </div>
    </div>
  );
}
