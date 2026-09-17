export async function saveToOPFS(relativePath: string, fileData: ArrayBuffer): Promise<void> {
    const opfsRoot = await navigator.storage.getDirectory();
    
    // Split path into parts and create directories
    const parts = relativePath.split('/');
    const fileName = parts.pop()!;
    let currentDir = opfsRoot;
    
    for (const part of parts) {
        if (part) {
            currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }
    }
    
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    // Write data (using FileSystemWritableFileStream)
    const writable = await fileHandle.createWritable();
    await writable.write(fileData);
    await writable.close();
}

export async function createOPFSWriter(relativePath: string): Promise<FileSystemWritableFileStream> {
    const opfsRoot = await navigator.storage.getDirectory();
    const parts = relativePath.split('/');
    const fileName = parts.pop()!;
    let currentDir = opfsRoot;
    
    for (const part of parts) {
        if (part) {
            currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }
    }
    
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    return await fileHandle.createWritable();
}

export async function downloadFromOPFS(relativePath: string): Promise<void> {
    const opfsRoot = await navigator.storage.getDirectory();
    const parts = relativePath.split('/');
    const fileName = parts.pop()!;
    let currentDir = opfsRoot;
    
    for (const part of parts) {
        if (part) {
            currentDir = await currentDir.getDirectoryHandle(part, { create: false });
        }
    }
    
    const fileHandle = await currentDir.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
