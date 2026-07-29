class CfgPatches {
    class SPECTRE_bridge {
        name = "SPECTRE C2 Bridge";
        author = "SPECTRE";
        requiredVersion = 2.06;
        requiredAddons[] = {};
        version = "1.2.0";
        versionStr = "1.2.0";
        units[] = {};
        weapons[] = {};
    };
};

class CfgFunctions {
    class SPECTRE {
        tag = "SPECTRE";
        class bridge {
            file = "z\spectre\addons\spectre_bridge\functions";
            class bridgeInit {};
        };
    };
};
