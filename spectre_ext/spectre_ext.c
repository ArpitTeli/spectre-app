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
    } else {
        GetModuleFileNameA(GetModuleHandleA("spectre_ext_x64.dll"), dllPath, MAX_PATH);
    }
    char* spectre = strstr(dllPath, "@SPECTRE");
    if (spectre) {
        spectre += 9;
        int len = (int)(spectre - dllPath);
        strncpy_s(basePath, MAX_PATH, dllPath, len);
    }
}

void readFile(const char* path, char* output, int outputSize) {
    FILE* f = NULL;
    errno_t err = fopen_s(&f, path, "rb");
    if (err != 0 || f == NULL) {
        snprintf(output, outputSize, "ERR_OPEN:%d:%s", err, path);
        return;
    }
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (fsize > 0 && fsize < outputSize - 1) {
        size_t bytes = fread(output, 1, fsize, f);
        output[bytes] = '\0';
    } else {
        snprintf(output, outputSize, "ERR_SIZE:%ld", fsize);
    }
    fclose(f);
    // Truncate file to prevent duplicate execution
    FILE* t = NULL;
    fopen_s(&t, path, "wb");
    if (t) fclose(t);
}

void stripQuotes(char* dest, const char* src, int maxLen) {
    const char* start = src;
    const char* end = src + strlen(src) - 1;
    while (*start == '"' || *start == ' ') start++;
    while (end > start && (*end == '"' || *end == ' ')) end--;
    int len = (int)(end - start + 1);
    if (len < 0) len = 0;
    if (len >= maxLen) len = maxLen - 1;
    strncpy_s(dest, maxLen, start, len);
}

__declspec(dllexport) void __stdcall RVExtensionVersion(char *output, int outputSize) {
    strncpy_s(output, outputSize, "SPECTRE Ext v1.0", _TRUNCATE);
}

__declspec(dllexport) void __stdcall RVExtension(char *output, int outputSize, const char *function) {
    if (!function || function[0] == '\0') { output[0] = '\0'; return; }
    ensureBasePath();
    char stripped[512];
    stripQuotes(stripped, function, sizeof(stripped));
    char fullPath[MAX_PATH];
    if (stripped[1] == ':' || stripped[0] == '\\') {
        strncpy_s(fullPath, MAX_PATH, stripped, _TRUNCATE);
    } else {
        strncpy_s(fullPath, MAX_PATH, basePath, _TRUNCATE);
        strncat_s(fullPath, MAX_PATH, stripped, _TRUNCATE);
    }
    readFile(fullPath, output, outputSize);
}

__declspec(dllexport) int __stdcall RVExtensionArgs(char *output, int outputSize, const char *function, const char **args, int argc) {
    if (function && strcmp(function, "READ") == 0 && argc >= 1 && args[0]) {
        ensureBasePath();
        char stripped[256];
        stripQuotes(stripped, args[0], sizeof(stripped));
        char fullPath[MAX_PATH];
        if (stripped[1] == ':' || stripped[0] == '\\') {
            strncpy_s(fullPath, MAX_PATH, stripped, _TRUNCATE);
        } else {
            strncpy_s(fullPath, MAX_PATH, basePath, _TRUNCATE);
            strncat_s(fullPath, MAX_PATH, stripped, _TRUNCATE);
        }
        readFile(fullPath, output, outputSize);
        return output[0] != '\0' ? 1 : 0;
    }
    snprintf(output, outputSize, "ERR_BAD_CALL:func=%s argc=%d", function ? function : "NULL", argc);
    return 0;
}
