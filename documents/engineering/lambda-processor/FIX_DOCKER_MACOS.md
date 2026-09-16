# Fix Docker macOS Security Warning

## The Issue
macOS is blocking Docker's network daemon (`com.docker.vmnetd`) because it's not signed with an Apple Developer certificate. This is a **false positive** - Docker is safe to use.

## Solution 1: Allow in System Settings (Recommended)

1. **Open System Settings:**
   - Apple menu → System Settings
   - Go to **Privacy & Security**

2. **Allow Docker:**
   - Scroll down to find the blocked Docker component
   - Click **"Allow Anyway"** or **"Open Anyway"**
   - You may need to enter your password

3. **Restart Docker Desktop:**
   - Quit Docker Desktop completely
   - Reopen Docker Desktop
   - Wait for it to fully start

## Solution 2: Use Terminal to Allow

```bash
# Remove the quarantine attribute
sudo xattr -rd com.apple.quarantine /Applications/Docker.app

# Or allow the specific component
sudo spctl --master-disable
# (Re-enable after: sudo spctl --master-enable)
```

## Solution 3: Use AWS CloudShell Instead (Easier!)

If you don't want to deal with macOS security settings, use AWS CloudShell - it's faster and doesn't require Docker:

See `QUICK_BUILD.md` for CloudShell instructions.
