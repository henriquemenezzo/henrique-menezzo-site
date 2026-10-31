#!/bin/zsh
# Uso: tools/encode-videos.sh <pasta-originais>. Lê tools/video-jobs.tsv e grava public/video.
ORIG="$1"; ROOT="${0:A:h:h}"
encode() {
  local file="$1" name="$2" width="$3" fps="$4" crf="$5"
  ffmpeg -y -v error -i "$ORIG/$file" -an -vf "fps=$fps,scale=$width:-2:flags=lanczos,format=yuv420p" \
    -c:v libx264 -preset slow -crf "$crf" -profile:v high -level 4.2 -movflags +faststart \
    -g $((fps * 2)) "$ROOT/public/video/$name.mp4"
  echo "ok $name $(du -h "$ROOT/public/video/$name.mp4" | cut -f1)"
}
while IFS=$'\t' read -r file name width fps crf; do
  while (( $(jobs -r | wc -l) >= 5 )); do sleep 0.3; done
  encode "$file" "$name" "$width" "$fps" "$crf" &
done < "$ROOT/tools/video-jobs.tsv"
wait
