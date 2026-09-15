import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const PARTICLE_COUNT = 130;
const CONNECTION_DIST = 0.30;
const SPEED = 0.00018;
const ACCENT = new THREE.Color('#34D399');
const WHITE  = new THREE.Color('#cfd2d6');

// Soft round sprite so points read as glowing dots, not squares.
function makeDotTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function Background() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x050505, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050505, 0.55);
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.z = 2;

    // ── Drifting accent glow — the "pop" ───────────────────────────────────────
    const dotTex = makeDotTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: dotTex, color: ACCENT, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(3.2, 3.2, 1);
    glow.position.set(-0.8, 0.3, -0.6);
    scene.add(glow);

    // ── Particles ──────────────────────────────────────────────────────────────
    const positions  = new Float32Array(PARTICLE_COUNT * 3);
    const colors      = new Float32Array(PARTICLE_COUNT * 3);
    const isAccent    = new Array(PARTICLE_COUNT);
    const velocities  = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 3.5;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      const accent = Math.random() < 0.16;          // ~1 in 6 nodes use the accent color
      isAccent[i] = accent;
      const col = accent ? ACCENT : WHITE;
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      velocities.push(
        (Math.random() - 0.5) * SPEED,
        (Math.random() - 0.5) * SPEED,
        (Math.random() - 0.5) * SPEED * 0.3,
      );
    }

    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dotGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    const dotMat = new THREE.PointsMaterial({
      map: dotTex, size: 0.05, vertexColors: true, transparent: true,
      opacity: 0.9, sizeAttenuation: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dots = new THREE.Points(dotGeo, dotMat);
    scene.add(dots);

    // ── Connection lines (rebuilt each frame) ───────────────────────────────────
    const lineGeo = new THREE.BufferGeometry();
    const maxLines = PARTICLE_COUNT * PARTICLE_COUNT;
    const linePos = new Float32Array(maxLines * 6);
    const lineCol = new Float32Array(maxLines * 6);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute('color',    new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    scene.add(lines);

    // ── Mouse parallax ───────────────────────────────────────────────────────────
    const mouse = { x: 0, y: 0 };
    const onMouseMove = (e) => {
      mouse.x = (e.clientX / window.innerWidth  - 0.5) * 0.12;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 0.08;
    };
    window.addEventListener('mousemove', onMouseMove);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    const pos = dotGeo.attributes.position;

    const buildLines = () => {
      let lineIdx = 0;
      const lp = lineGeo.attributes.position.array;
      const lc = lineGeo.attributes.color.array;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ax = pos.array[i * 3], ay = pos.array[i * 3 + 1], az = pos.array[i * 3 + 2];
        for (let j = i + 1; j < PARTICLE_COUNT; j++) {
          const dx = ax - pos.array[j * 3];
          const dy = ay - pos.array[j * 3 + 1];
          const dz = az - pos.array[j * 3 + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < CONNECTION_DIST) {
            const a = (1 - dist / CONNECTION_DIST);
            // tint the link toward accent if either endpoint is an accent node
            const accentLink = isAccent[i] || isAccent[j];
            const r = accentLink ? ACCENT.r * a * 0.6 : a * 0.22;
            const g = accentLink ? ACCENT.g * a * 0.6 : a * 0.22;
            const b = accentLink ? ACCENT.b * a * 0.6 : a * 0.22;
            lp[lineIdx * 6]     = ax; lp[lineIdx * 6 + 1] = ay; lp[lineIdx * 6 + 2] = az;
            lp[lineIdx * 6 + 3] = pos.array[j * 3]; lp[lineIdx * 6 + 4] = pos.array[j * 3 + 1]; lp[lineIdx * 6 + 5] = pos.array[j * 3 + 2];
            lc[lineIdx * 6] = r; lc[lineIdx * 6 + 1] = g; lc[lineIdx * 6 + 2] = b;
            lc[lineIdx * 6 + 3] = r; lc[lineIdx * 6 + 4] = g; lc[lineIdx * 6 + 5] = b;
            lineIdx++;
            if (lineIdx >= maxLines / 2) break;
          }
        }
        if (lineIdx >= maxLines / 2) break;
      }
      lineGeo.setDrawRange(0, lineIdx * 2);
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
    };

    let raf;
    let t = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      t += 0.005;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        pos.array[i * 3]     += velocities[i * 3];
        pos.array[i * 3 + 1] += velocities[i * 3 + 1];
        pos.array[i * 3 + 2] += velocities[i * 3 + 2];
        if (Math.abs(pos.array[i * 3])     > 1.8)  velocities[i * 3]     *= -1;
        if (Math.abs(pos.array[i * 3 + 1]) > 1.1)  velocities[i * 3 + 1] *= -1;
        if (Math.abs(pos.array[i * 3 + 2]) > 0.65) velocities[i * 3 + 2] *= -1;
      }
      pos.needsUpdate = true;
      buildLines();

      // slow drift of the accent glow + gentle breathing
      glow.position.x = Math.sin(t * 0.5) * 1.1;
      glow.position.y = Math.cos(t * 0.35) * 0.5;
      glowMat.opacity = 0.18 + Math.sin(t) * 0.05;

      camera.position.x += (mouse.x - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y - camera.position.y) * 0.04;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
    };

    if (reduced) {
      buildLines();
      renderer.render(scene, camera);
    } else {
      animate();
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      dotTex.dispose();
      dotGeo.dispose();
      lineGeo.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 -z-10"
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
