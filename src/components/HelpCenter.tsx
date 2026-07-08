'use client';

export default function HelpCenter({
  onClose,
  onStartTutorial,
  onGuide,
  guideUrl,
}: {
  onClose?: () => void;
  onStartTutorial?: () => void;
  onGuide?: () => void;
  guideUrl?: string;
}) {
  void onClose;
  void onStartTutorial;
  void onGuide;
  void guideUrl;
  return null;
}
