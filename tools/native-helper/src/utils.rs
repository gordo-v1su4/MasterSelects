//! Cross-platform utility functions

use std::path::PathBuf;

/// Apply CREATE_NO_WINDOW flag on Windows to prevent terminal popups.
/// Call this on any `tokio::process::Command` before `.output()` or `.spawn()`.
#[cfg(windows)]
pub fn no_window(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000)
}

#[cfg(not(windows))]
pub fn no_window(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    cmd
}

/// Apply CREATE_NO_WINDOW flag on Windows for std::process::Command.
#[cfg(windows)]
pub fn no_window_std(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000)
}

#[cfg(not(windows))]
pub fn no_window_std(cmd: &mut std::process::Command) -> &mut std::process::Command {
    cmd
}

/// Get the default download directory for videos
pub fn get_download_dir() -> PathBuf {
    let base = std::env::temp_dir();
    base.join("masterselects-downloads")
}

/// Get the default project root directory
/// Can be overridden via MASTERSELECTS_PROJECT_ROOT env var
pub fn get_project_root() -> PathBuf {
    if let Ok(custom) = std::env::var("MASTERSELECTS_PROJECT_ROOT") {
        let p = PathBuf::from(custom);
        if p.is_absolute() {
            return p;
        }
    }

    if let Some(docs) = dirs::document_dir() {
        return docs.join("MasterSelects");
    }

    // Fallback: home directory
    if let Some(home) = dirs::home_dir() {
        return home.join("MasterSelects");
    }

    PathBuf::from("MasterSelects")
}

/// Get allowed file serving prefixes (for security)
pub fn get_allowed_prefixes() -> Vec<PathBuf> {
    let mut prefixes = Vec::new();

    // User's Downloads folder (cross-platform)
    if let Some(downloads) = dirs::download_dir() {
        prefixes.push(downloads);
    }

    // Temp directory
    prefixes.push(std::env::temp_dir());

    // On Unix, also allow /tmp explicitly
    #[cfg(unix)]
    {
        prefixes.push(PathBuf::from("/tmp"));
    }

    // Documents directory (for project persistence)
    if let Some(docs) = dirs::document_dir() {
        prefixes.push(docs);
    }

    // MasterSelects project root (may be custom via env var)
    let project_root = get_project_root();
    if !prefixes.iter().any(|p| project_root.starts_with(p)) {
        prefixes.push(project_root);
    }

    // User's Videos folder (for media file serving)
    if let Some(videos) = dirs::video_dir() {
        prefixes.push(videos);
    }

    // User's Desktop (drag & drop sources)
    if let Some(desktop) = dirs::desktop_dir() {
        prefixes.push(desktop);
    }

    // NOTE: Home directory fallback intentionally removed for security.
    // Only explicit, scoped directories are allowed.

    prefixes
}

/// Check if a path contains path traversal segments
fn has_traversal_segments(path: &std::path::Path) -> bool {
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return true;
        }
    }
    // Also check the raw string for encoded or sneaky ".." patterns
    let path_str = path.to_string_lossy();
    path_str.contains("..")
}

/// Check if a path is within allowed directories.
///
/// Rejects paths with `..` traversal segments and attempts path canonicalization
/// to prevent symlink or alias-based escapes. Fails closed: if canonicalization
/// fails and the path doesn't exist, the path is rejected.
pub fn is_path_allowed(path: &std::path::Path) -> bool {
    // Reject any path with traversal segments
    if has_traversal_segments(path) {
        return false;
    }

    let allowed = get_allowed_prefixes();

    // Try to canonicalize the path for safer comparison.
    // If the path exists, use the canonical version.
    // If the path doesn't exist, use the raw path but only if it has no suspicious segments.
    let effective_path = match path.canonicalize() {
        Ok(canonical) => canonical,
        Err(_) => {
            // Path doesn't exist yet (e.g., writing a new file).
            // Check the parent directory instead if possible.
            if let Some(parent) = path.parent() {
                if let Ok(canonical_parent) = parent.canonicalize() {
                    if let Some(file_name) = path.file_name() {
                        canonical_parent.join(file_name)
                    } else {
                        return false; // No filename component
                    }
                } else {
                    // Neither path nor parent can be canonicalized — fail closed
                    return false;
                }
            } else {
                return false; // No parent (root path or relative)
            }
        }
    };

    // Normalize for case-insensitive comparison on Windows
    // Also normalize path separators (frontend may send forward slashes)
    #[cfg(windows)]
    {
        let path_str = effective_path.to_string_lossy().to_lowercase().replace('/', "\\");
        return allowed.iter().any(|prefix| {
            let prefix_canonical = prefix.canonicalize().unwrap_or_else(|_| prefix.clone());
            let prefix_str = prefix_canonical.to_string_lossy().to_lowercase().replace('/', "\\");
            path_str.starts_with(&*prefix_str)
        });
    }

    #[cfg(not(windows))]
    {
        let path_str = effective_path.to_string_lossy();
        return allowed.iter().any(|prefix| {
            let prefix_canonical = prefix.canonicalize().unwrap_or_else(|_| prefix.clone());
            let prefix_str = prefix_canonical.to_string_lossy();
            path_str.starts_with(prefix_str.as_ref())
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_allowed_path_in_project_root() {
        let project_root = get_project_root();
        let test_path = project_root.join("test-project").join("data.json");
        // The path is under the project root, which is in the allowed prefixes
        // Since the path doesn't exist, we need to ensure the project root exists first
        // For unit test purposes, verify the prefix matching logic
        let prefixes = get_allowed_prefixes();
        let is_under_prefix = prefixes.iter().any(|p| test_path.starts_with(p));
        assert!(is_under_prefix, "Project root path should be under an allowed prefix");
    }

    #[test]
    fn test_allowed_path_in_download_dir() {
        let download_dir = get_download_dir();
        let test_path = download_dir.join("video.mp4");
        // Downloads dir is under temp, which is always allowed
        let prefixes = get_allowed_prefixes();
        let is_under_prefix = prefixes.iter().any(|p| test_path.starts_with(p));
        assert!(is_under_prefix, "Download dir path should be under an allowed prefix");
    }

    #[test]
    fn test_rejected_path_home_root() {
        // After removing the home directory fallback, a bare path under home
        // that isn't in Downloads/Documents/Desktop/Videos should be rejected
        if let Some(home) = dirs::home_dir() {
            let test_path = home.join(".ssh").join("id_rsa");
            // .ssh is not under any of the allowed specific directories
            let prefixes = get_allowed_prefixes();
            let is_under_specific = prefixes.iter().any(|p| test_path.starts_with(p));
            // This should NOT be allowed (unless .ssh happens to be under Documents, etc.)
            // We can't assert false unconditionally because home might equal a prefix on some systems
            // But the key point is that home itself is NOT in the prefix list
            let home_in_prefixes = prefixes.iter().any(|p| p == &home);
            assert!(!home_in_prefixes, "Home directory should not be in allowed prefixes");
        }
    }

    #[test]
    fn test_rejected_path_system() {
        #[cfg(windows)]
        {
            let system_path = Path::new("C:\\Windows\\System32\\cmd.exe");
            assert!(!is_path_allowed(system_path), "System paths should be rejected");
        }

        #[cfg(unix)]
        {
            let system_path = Path::new("/etc/passwd");
            assert!(!is_path_allowed(system_path), "System paths should be rejected");
        }
    }

    #[test]
    fn test_rejected_path_traversal() {
        let download_dir = get_download_dir();
        let traversal_path = download_dir.join("..").join("..").join("etc").join("passwd");
        assert!(has_traversal_segments(&traversal_path), "Path with .. should be detected as traversal");
        assert!(!is_path_allowed(&traversal_path), "Paths with traversal should be rejected");
    }

    #[test]
    fn test_path_normalization_windows() {
        // Test that forward slashes work correctly (frontend sends forward slashes)
        let download_dir = get_download_dir();
        let download_str = download_dir.to_string_lossy().replace('\\', "/");
        let forward_slash_path = PathBuf::from(format!("{}/test-video.mp4", download_str));

        // The path should contain forward slashes
        assert!(forward_slash_path.to_string_lossy().contains('/') || cfg!(not(windows)),
            "Test path should use forward slashes on Windows");

        // On all platforms, verify the basic prefix logic works with normalized paths
        let prefixes = get_allowed_prefixes();
        let download_is_prefix = prefixes.iter().any(|p| {
            let p_str = p.to_string_lossy().to_lowercase().replace('\\', "/");
            let path_str = forward_slash_path.to_string_lossy().to_lowercase().replace('\\', "/");
            path_str.starts_with(&*p_str)
        });
        assert!(download_is_prefix, "Forward-slash paths should match against allowed prefixes");
    }
}
