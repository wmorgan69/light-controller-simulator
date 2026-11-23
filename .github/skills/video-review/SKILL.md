---
name: video-review
description: Prepare timestamped frames from a local video for a read-only UX reviewer. Use when a UX review needs evidence from a video the reviewer cannot decode directly.
---

# Video review

The parent agent prepares the evidence; the `ux-reviewer` remains read-only. Extract frames locally and pass their absolute paths and requested timestamps to the reviewer. Do not upload the video or frames to an external service. Treat them as potentially sensitive and keep temporary files out of the repository.

1. Confirm that local `ffmpeg` is available and the input file exists. If it is unavailable or cannot decode the video, report the limitation; do not claim a video review was completed.
2. Select timestamps relevant to the requested review, including important states and transitions. When needed, extract additional frames around a transition. The example timestamps are illustrative; adjust them to the video's duration and the review scope.
3. Extract each frame to a new, uniquely named temporary directory. The following PowerShell example runs from the repository root and samples the checked-in demo at 1, 5, and 10 seconds:

   ```powershell
   $video = (Resolve-Path -LiteralPath 'docs\assets\videos\building-lighting-demo.webm' -ErrorAction Stop).Path
   $frames = Join-Path ([System.IO.Path]::GetTempPath()) ('ux-video-review-' + [guid]::NewGuid().ToString('N'))
   New-Item -ItemType Directory -Path $frames -ErrorAction Stop | Out-Null
   foreach ($seconds in @(1, 5, 10)) {
       $frame = Join-Path $frames ('frame-{0:D6}s.png' -f $seconds)
       & ffmpeg -hide_banner -loglevel error -nostdin -n -ss $seconds -i $video -frames:v 1 $frame
       if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $frame -PathType Leaf)) {
           throw "Frame extraction failed at ${seconds}s; check the input and timestamp."
       }
       Write-Output ("Requested {0}s: {1}" -f $seconds, $frame)
   }
   ```

4. Inspect the extracted images before passing them to the reviewer. Give the reviewer the video context, each absolute image path and its requested timestamp, and the specific UX questions. The reviewer should report whether it could actually read the supplied frames.
5. Report the sampling limitations: requested timestamps are approximate, still frames do not establish continuous motion or audio, and a recording does not replace live keyboard, accessibility, or responsive checks. If important evidence could not be inspected, say so explicitly.
6. After the review and any follow-up, remove only the specific temporary files and directory created for this review. Do not delete the source video or any shared directories.
