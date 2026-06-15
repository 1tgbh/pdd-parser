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
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  const handleLoad = useCallback(() => {
    setHasError(false);
  }, []);

  const imgSrc = useMemo(() => src || '', [src]);

  if (hasError && !imgSrc) {
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
