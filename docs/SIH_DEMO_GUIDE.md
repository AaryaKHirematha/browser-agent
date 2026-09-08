# SIH Demo Guide

## Prerequisites
- Node.js (v20+)
- Google Chrome
- FFmpeg (must be available in PATH)

## One-Command Recording
To generate the complete autonomous SIH demo video, run:
```bash
npm run demo:record
```

## Expected Output
The script will output a fully recorded video to:
`demo-recordings/SIH_Trustworthy_Browser_Agent_Final_Demo.mp4`

## Important Note on Git
The final `.mp4` video is **intentionally NOT committed to Git**.
Videos create excessive repository bloat and binary merge conflicts.
The `demo-recordings/` directory is explicitly ignored in `.gitignore`.

## Troubleshooting
- **Missing Playwright?** The script should attempt to auto-install dependencies. If it fails, run `cd bench && npm install`.
- **FFmpeg not found?** Ensure FFmpeg is installed and added to your system `PATH`.
- **Port conflicts?** The demo runs servers on ports 3000, 8777, and 8778. Ensure these are free before running the demo.
