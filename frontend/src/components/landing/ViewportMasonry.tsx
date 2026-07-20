'use client';

/**
 * Live Court Viewport masonry — curated photography tiles with native CSS
 * slow hover-zoom. Art direction lives with the data in lib/landing-data.
 */
import Image from 'next/image';
import { motion } from 'motion/react';
import { VIEWPORT_TILES } from '@/lib/landing-data';
import { REVEAL, REVEAL_GROUP } from './reveal';

export function ViewportMasonry() {
  return (
    <motion.section className="landing-section" initial="hidden" whileInView="visible"
      viewport={{ once: true, margin: '-70px' }} variants={REVEAL_GROUP}>
      <motion.div variants={REVEAL} className="section-head">
        <h2>The Live Court Viewport</h2>
        <p style={{ marginTop: 8 }}>Purpose-built for padel and tennis clubs that feel like members-only lounges.</p>
      </motion.div>
      <motion.div variants={REVEAL} className="viewport-masonry">
        {VIEWPORT_TILES.map((tile) => (
          <div key={tile.src} className={`viewport-tile ${tile.span}`}>
            <div className="tile-art">
              <Image
                src={tile.src}
                alt={tile.alt}
                fill
                loading="lazy"
                sizes={tile.wide ? '(max-width: 880px) 100vw, 560px' : '(max-width: 880px) 50vw, 270px'}
                style={{ objectFit: 'cover' }}
              />
            </div>
            <div className="tile-caption"><strong>{tile.title}</strong><span>{tile.sub}</span></div>
          </div>
        ))}
      </motion.div>
    </motion.section>
  );
}
