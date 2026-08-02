#include <stdio.h>
#include <string.h>
#include <windows.h>

#define MAX_OUTPUT 10240

static char basePath[MAX_PATH] = {0};

void ensureBasePath() {
    if (basePath[0] != 0) return;
    char dllPath[MAX_PATH] = {0};
    HMODULE hm = NULL;
    if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        (LPCSTR)&ensureBasePath, &hm) && hm) {
        GetModuleFileNameA(hm, dllPath, MAX_PATH);
    }
    if (dllPath[0] == 0) {
        GetModuleFileNameA(GetModuleHandleA("spectre_ext_x64.dll"), dllPath, MAX_PATH);
    }
    if (dllPath[0] == 0) {
        // Last resort: try Arma install directory
        strncpy(basePath, "E:\\Games\\Arma 3\\@SPECTRE\\", MAX_PATH - 1);
        basePath[MAX_PATH - 1] = '\0';
        return;
    }
    char* spectre = strstr(dllPath, "@SPECTRE");
    if (spectre) {
        // "@SPECTRE" is 8 chars; step past it AND the trailing backslash so
        // basePath keeps the separator (v1.11.50 accidentally used += 8,
        // yielding "...@SPECTREaddons\..." and ERR_OPEN on every read).
        spectre += 9;
        int len = (int)(spectre - dllPath);
        if (len >= MAX_PATH) len = MAX_PATH - 1;
        strncpy(basePath, dllPath, len);
        basePath[len] = '\0';
    } else {
        // Not found in path — try Arma install directory as fallback
        strncpy(basePath, "E:\\Games\\Arma 3\\@SPECTRE\\", MAX_PATH - 1);
        basePath[MAX_PATH - 1] = '\0';
    }
}

void readFile(const char* path, char* output, int outputSize) {
    FILE* f = fopen(path, "rb");
    if (f == NULL) {
        snprintf(output, outputSize, "ERR_OPEN:%s", path);
        return;
    }
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (fsize == 0) {
        // Empty file is the normal state (consume-once protocol) — return an
        // empty string, NOT an error, so the reader exits quietly.
        output[0] = '\0';
    } else if (fsize > 0 && fsize < outputSize - 1) {
        size_t bytes = fread(output, 1, fsize, f);
        output[bytes] = '\0';
    } else {
        snprintf(output, outputSize, "ERR_SIZE:%ld", fsize);
    }
    fclose(f);
}

// Consume-once read: returns the file content, then truncates the file so the
// command is executed exactly once and can never be re-read (or lost to a
// stale-copy desync). The app only writes when the file is empty (write-if-
// empty), and re-sends unacked commands with fresh ids, so a lost write is
// self-healing and double execution is impossible by construction.
void readFileAndClear(const char* path, char* output, int outputSize) {
    readFile(path, output, outputSize);
    if (output[0] != '\0' && strncmp(output, "ERR_", 4) != 0) {
        // The app may hold the file open briefly during its write; retry the
        // truncate so unconsumed content never accumulates toward the output
        // cap (which would otherwise end in ERR_SIZE and drop every command).
        for (int i = 0; i < 5; i++) {
            FILE* f = fopen(path, "wb");
            if (f != NULL) {
                fclose(f);
                break;
            }
            Sleep(50);
        }
    }
}

void stripQuotes(char* dest, const char* src, int maxLen) {
    if (!src || !*src || maxLen <= 0) { if (maxLen > 0) dest[0] = '\0'; return; }
    const char* start = src;
    const char* end = src + strlen(src) - 1;
    while (*start == '"' || *start == ' ') { if (!*start) break; start++; }
    while (end > start && (*end == '"' || *end == ' ')) end--;
    int len = (int)(end - start + 1);
    if (len < 0) len = 0;
    if (len >= maxLen) len = maxLen - 1;
    strncpy(dest, start, len);
    dest[len] = '\0';
}

__declspec(dllexport) void __stdcall RVExtensionVersion(char *output, int outputSize) {
    strncpy(output, "SPECTRE Ext v2.0", outputSize - 1);
    output[outputSize - 1] = '\0';
}

__declspec(dllexport) void __stdcall RVExtension(char *output, int outputSize, const char *function) {
    if (!function || function[0] == '\0') { output[0] = '\0'; return; }
    ensureBasePath();
    char stripped[512];
    stripQuotes(stripped, function, sizeof(stripped));
    char fullPath[MAX_PATH];
    if (stripped[1] == ':' || stripped[0] == '\\') {
        strncpy(fullPath, stripped, MAX_PATH - 1);
        fullPath[MAX_PATH - 1] = '\0';
    } else {
        strncpy(fullPath, basePath, MAX_PATH - 1);
        fullPath[MAX_PATH - 1] = '\0';
        strncat(fullPath, stripped, MAX_PATH - strlen(fullPath) - 1);
    }
    readFile(fullPath, output, outputSize);
}

__declspec(dllexport) int __stdcall RVExtensionArgs(char *output, int outputSize, const char *function, const char **args, int argc) {
    if (function && argc >= 1 && args[0] &&
        (strcmp(function, "READ") == 0 || strcmp(function, "READ_CLEAR") == 0)) {
        ensureBasePath();
        char stripped[256];
        stripQuotes(stripped, args[0], sizeof(stripped));
        char fullPath[MAX_PATH];
        if (stripped[1] == ':' || stripped[0] == '\\') {
            strncpy(fullPath, stripped, MAX_PATH - 1);
            fullPath[MAX_PATH - 1] = '\0';
        } else {
            strncpy(fullPath, basePath, MAX_PATH - 1);
            fullPath[MAX_PATH - 1] = '\0';
            strncat(fullPath, stripped, MAX_PATH - strlen(fullPath) - 1);
        }
        if (strcmp(function, "READ_CLEAR") == 0) {
            readFileAndClear(fullPath, output, outputSize);
        } else {
            readFile(fullPath, output, outputSize);
        }
        return output[0] != '\0' ? 1 : 0;
    }
    snprintf(output, outputSize, "ERR_BAD_CALL:func=%s argc=%d", function ? function : "NULL", argc);
    return 0;
}
