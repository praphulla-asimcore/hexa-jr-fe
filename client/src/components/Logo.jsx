import React from 'react';
import hexaLogo from '../assets/hexa-logo.png';

export default function Logo({ size = 32 }) {
  return (
    <img
      src={hexaLogo}
      alt="Hexa"
      style={{ height: size, width: 'auto', display: 'block' }}
    />
  );
}
