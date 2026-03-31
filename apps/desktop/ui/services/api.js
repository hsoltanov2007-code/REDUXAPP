export async function getServerBaseUrl() {
  return await window.hardy.getServerUrl();
}

export async function api(path, { method = "GET", body, token } = {}) {
  const base = await getServerBaseUrl();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export async function uploadZip(file, token) {
  const base = await getServerBaseUrl();
  const fd = new FormData();
  fd.append("file", file);

  const response = await fetch(`${base}/admin/mods/upload-zip`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: fd
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Upload failed");
  return data;
}
