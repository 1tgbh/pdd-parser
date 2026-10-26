import React, { useState, useCallback, useMemo } from 'react';

type Props = {
  src: string;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
};

const SafeImage: React.FC<Props> = ({ src, alt, className, fallback, style, onClick }) => {
  const [failedSrc, setFailedSrc] = useState('');

  const imgSrc = useMemo(() => {
    try {
      const url = new URL(src);
      if (/^https?:$/.test(url.protocol) && /(^|\.)(pddpic\.com|yangkeduo\.com)$/.test(url.hostname)) {
        return '/api/proxy-image?url=' + encodeURIComponent(src);
      }
    } catch { /* Local image path. */ }
    return src || '';
  }, [src]);

  const handleError = useCallback(() => {
    setFailedSrc(imgSrc);
  }, [imgSrc]);

  const handleLoad = useCallback(() => {
    setFailedSrc('');
  }, []);

  if (!imgSrc || failedSrc === imgSrc) {
    return fallback || <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 4 }} />;
  }

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      onError={handleError}
      onLoad={handleLoad}
      style={{ ...style, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      referrerPolicy="no-referrer"
    />
  );
};

export default SafeImage;
