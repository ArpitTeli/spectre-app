import React, { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape from 'cytoscape';
import { readVaultNodes, buildGraphFromWikilinks } from '../lib/vault';

const NODE_COLORS = {
  unit:      '#2a7de1',
  contact:   '#db3838',
  objective: '#23d160',
  phase:     '#f5a623',
  intel:     '#a687e5',
  mission:   '#525252'
};

const NODE_SHAPES = {
  unit:      'ellipse',
  contact:   'diamond',
  objective: 'round-hexagon',
  phase:     'round-rectangle',
  intel:     'vee',
  mission:   'star'
};

export default function VaultGraph({ vaultPath, units, contacts }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState(null);

  const buildGraph = useCallback(async () => {
    if (!vaultPath || !containerRef.current) return;

    setLoading(true);
    try {
      const nodes = await readVaultNodes(vaultPath);
      if (!nodes.length) {
        setLoading(false);
        return;
      }

      const edges = buildGraphFromWikilinks(nodes);

      // Build Cytoscape elements
      const elements = [];

      for (const node of nodes) {
        const fm = node.frontmatter;
        if (!fm?.id) continue;

        const type = fm.type || 'unknown';
        const label = fm.callsign || fm.name || fm.id;
        const live = type === 'unit' ? units?.[fm.id] : type === 'contact' ? contacts?.[fm.id] : null;
        const status = live?.status || fm.status || fm.state || '';

        elements.push({
          group: 'nodes',
          data: {
            id: fm.id,
            label: label,
            type: type,
            status: status,
            color: NODE_COLORS[type] || '#525252',
            shape: NODE_SHAPES[type] || 'ellipse',
            health: fm.health,
            threat_level: fm.threat_level,
            priority: fm.priority
          }
        });
      }

      for (const edge of edges) {
        // Only add edge if both source and target exist
        const hasSource = nodes.some(n => n.frontmatter?.id === edge.source);
        const hasTarget = nodes.some(n => n.frontmatter?.id === edge.target);
        if (hasSource && hasTarget) {
          elements.push({
            group: 'edges',
            data: {
              id: `${edge.source}-${edge.target}`,
              source: edge.source,
              target: edge.target,
              label: edge.label || ''
            }
          });
        }
      }

      setNodeCount(elements.filter(e => e.group === 'nodes').length);
      setEdgeCount(elements.filter(e => e.group === 'edges').length);

      // Destroy old instance
      if (cyRef.current) {
        cyRef.current.destroy();
      }

      const cy = cytoscape({
        container: containerRef.current,
        elements: elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': 'data(color)',
              'label': 'data(label)',
              'color': '#f5f6f7',
              'font-size': '10px',
              'font-family': 'Inter, sans-serif',
              'font-weight': 600,
              'text-valign': 'bottom',
              'text-margin-y': 6,
              'text-outline-color': '#1b1b1b',
              'text-outline-width': 2,
              'width': 28,
              'height': 28,
              'border-width': 2,
              'border-color': 'data(color)',
              'border-opacity': 0.6,
              'shape': 'data(shape)'
            }
          },
          {
            selector: 'node[type="unit"]',
            style: {
              'width': 32,
              'height': 32
            }
          },
          {
            selector: 'node[type="mission"]',
            style: {
              'width': 40,
              'height': 40,
              'font-size': '12px'
            }
          },
          {
            selector: 'node[status="DEAD"], node[status="DESTROYED"]',
            style: {
              'opacity': 0.3,
              'border-style': 'dashed'
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 1.5,
              'line-color': '#3a3a3a',
              'target-arrow-color': '#3a3a3a',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.8,
              'curve-style': 'bezier',
              'opacity': 0.5
            }
          },
          {
            selector: ':selected',
            style: {
              'border-width': 3,
              'border-color': '#ffffff',
              'border-opacity': 1,
              'background-opacity': 1
            }
          },
          {
            selector: 'node:selected',
            style: {
              'width': 36,
              'height': 36
            }
          }
        ],
        layout: {
          name: 'cose',
          animate: true,
          animationDuration: 800,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 100,
          gravity: 0.25,
          numIter: 500,
          padding: 40
        },
        minZoom: 0.3,
        maxZoom: 3,
        wheelSensitivity: 0.3,
        boxSelectionEnabled: false
      });

      // Click handler
      cy.on('tap', 'node', (evt) => {
        const data = evt.target.data();
        setSelectedNode(data);
      });

      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          setSelectedNode(null);
        }
      });

      cyRef.current = cy;
      setLoading(false);

      // Fit after layout finishes
      setTimeout(() => {
        if (cyRef.current && !cyRef.current.destroyed()) {
          cyRef.current.fit(undefined, 30);
        }
      }, 900);

    } catch (e) {
      console.error('VaultGraph build failed:', e);
      setLoading(false);
    }
  }, [vaultPath, units, contacts]);

  useEffect(() => {
    buildGraph();
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [buildGraph]);

  if (!vaultPath) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
        No vault active.<br />Generate OPORD + COA to create the knowledge graph.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Stats bar */}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        gap: '12px',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--text-muted)',
        flexShrink: 0
      }}>
        <span>{nodeCount} nodes</span>
        <span>{edgeCount} edges</span>
        {loading && <span style={{ color: 'var(--accent)' }}>loading...</span>}
      </div>

      {/* Legend */}
      <div style={{
        padding: '4px 10px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        flexShrink: 0
      }}>
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase'
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block' }} />
            {type}
          </span>
        ))}
      </div>

      {/* Graph container */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#141414' }} />

        {/* Selected node detail */}
        {selectedNode && (
          <div style={{
            position: 'absolute', bottom: '8px', left: '8px', right: '8px',
            background: 'rgba(27,27,27,0.95)',
            border: '1px solid var(--border-default)',
            borderRadius: '3px',
            padding: '8px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontWeight: 700, color: selectedNode.color }}>{selectedNode.label}</span>
              <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>{selectedNode.type}</span>
            </div>
            {selectedNode.status && (
              <div style={{ color: 'var(--text-secondary)' }}>Status: {selectedNode.status}</div>
            )}
            {selectedNode.health !== undefined && (
              <div style={{ color: 'var(--text-secondary)' }}>HP: {selectedNode.health}%</div>
            )}
            {selectedNode.threat_level && (
              <div style={{ color: 'var(--text-secondary)' }}>Threat: {selectedNode.threat_level}</div>
            )}
            {selectedNode.priority && (
              <div style={{ color: 'var(--text-secondary)' }}>Priority: {selectedNode.priority}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
