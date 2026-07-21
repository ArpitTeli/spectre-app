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
}

__declspec(dllexport) void __stdcall RVExtensionVersion(char *output, int outputSize) {
    strncpy_s(output, outputSize, "SPECTRE Ext v1.0", _TRUNCATE);
}

__declspec(dllexport) void __stdcall RVExtension(char *output, int outputSize, const char *function) {
    ensureBasePath();
    char fullPath[MAX_PATH];
    if (function && function[0] != '\0') {
        if (function[1] == ':' || function[0] == '\\') {
            strncpy_s(fullPath, MAX_PATH, function, _TRUNCATE);
        } else {
            strncpy_s(fullPath, MAX_PATH, basePath, _TRUNCATE);
            strncat_s(fullPath, MAX_PATH, function, _TRUNCATE);
        }
        readFile(fullPath, output, outputSize);
    }
}

__declspec(dllexport) int __stdcall RVExtensionArgs(char *output, int outputSize, const char *function, const char **args, int argc) {
    if (function && strcmp(function, "READ") == 0 && argc >= 1 && args[0]) {
        ensureBasePath();
        char fullPath[MAX_PATH];
        if (args[0][1] == ':' || args[0][0] == '\\') {
            strncpy_s(fullPath, MAX_PATH, args[0], _TRUNCATE);
        } else {
            strncpy_s(fullPath, MAX_PATH, basePath, _TRUNCATE);
            strncat_s(fullPath, MAX_PATH, args[0], _TRUNCATE);
        }
        readFile(fullPath, output, outputSize);
        return output[0] != '\0' ? 1 : 0;
    }
    snprintf(output, outputSize, "ERR_BAD_CALL:func=%s argc=%d", function ? function : "NULL", argc);
    return 0;
}
