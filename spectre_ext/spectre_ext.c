#include <stdio.h>
#include <string.h>
#include <windows.h>

#define MAX_OUTPUT 10240

static char basePath[MAX_PATH] = {0};

void ensureBasePath() {
    if (basePath[0] != 0) return;
    char dllPath[MAX_PATH];
    GetModuleFileNameA(GetModuleHandleA("spectre_ext_x64.dll"), dllPath, MAX_PATH);
    // Find @SPECTRE\ in the path and use that as base
    char* spectre = strstr(dllPath, "@SPECTRE");
    if (spectre) {
        spectre += 9; // skip "@SPECTRE\"
        // Find addons\ or use the mod root
        strncpy_s(basePath, MAX_PATH, dllPath, (int)(spectre - dllPath));
        basePath[(int)(spectre - dllPath)] = '\0';
    } else {
        strncpy_s(basePath, MAX_PATH, "E:\\Games\\Arma 3\\@SPECTRE\\", _TRUNCATE);
    }
}

__declspec(dllexport) void __stdcall RVExtensionVersion(char *output, int outputSize) {
    strncpy_s(output, outputSize, "SPECTRE Ext v1.0", _TRUNCATE);
}

void readFile(const char* path, char* output, int outputSize) {
    FILE* f;
    if (fopen_s(&f, path, "rb") == 0 && f != NULL) {
        fseek(f, 0, SEEK_END);
        long fsize = ftell(f);
        fseek(f, 0, SEEK_SET);
        if (fsize > 0 && fsize < outputSize - 1) {
            size_t bytes = fread(output, 1, fsize, f);
            output[bytes] = '\0';
        }
        fclose(f);
    } else {
        output[0] = '\0';
    }
}

__declspec(dllexport) void __stdcall RVExtension(char *output, int outputSize, const char *function) {
    ensureBasePath();
    char fullPath[MAX_PATH];
    if (function && function[0] != '\0') {
        // If function starts with a drive letter or \/, use it directly
        if (function[1] == ':' || function[0] == '\\') {
            strncpy_s(fullPath, MAX_PATH, function, _TRUNCATE);
        } else {
            // Relative to basePath
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
    output[0] = '\0';
    return 0;
}
