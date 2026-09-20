"""Windows virtual-key → KeyPulse key labels (aligned with macOS client)."""

VK_RETURN = 0x0D
LLKHF_EXTENDED = 0x01

# Static VK → label map. Modifier keys merge left/right like macOS.
VK_KEY_NAMES: dict[int, str] = {
    0x08: "Backspace",
    0x09: "Tab",
    0x0D: "Enter",
    0x1B: "Esc",
    0x20: "Space",
    0x14: "Caps",
    0x10: "Shift",
    0xA0: "Shift",
    0xA1: "Shift",
    0x11: "Ctrl",
    0xA2: "Ctrl",
    0xA3: "Ctrl",
    0x12: "Option",
    0xA4: "Option",
    0xA5: "Option",
    0x5B: "Command",
    0x5C: "Command",
    0xBA: ";",
    0xBB: "=",
    0xBC: ",",
    0xBD: "-",
    0xBE: ".",
    0xBF: "/",
    0xC0: "`",
    0xDB: "[",
    0xDC: "\\",
    0xDD: "]",
    0xDE: "'",
    0x21: "PageUp",
    0x22: "PageDown",
    0x23: "End",
    0x24: "Home",
    0x25: "Left",
    0x26: "Up",
    0x27: "Right",
    0x28: "Down",
    0x2D: "Insert",
    0x2E: "Delete",
    0x70: "F1",
    0x71: "F2",
    0x72: "F3",
    0x73: "F4",
    0x74: "F5",
    0x75: "F6",
    0x76: "F7",
    0x77: "F8",
    0x78: "F9",
    0x79: "F10",
    0x7A: "F11",
    0x7B: "F12",
    0x90: "NumLock",
    0x6A: "Num*",
    0x6B: "Num+",
    0x6D: "Num-",
    0x6E: "Num.",
    0x6F: "Num/",
    0x60: "Num0",
    0x61: "Num1",
    0x62: "Num2",
    0x63: "Num3",
    0x64: "Num4",
    0x65: "Num5",
    0x66: "Num6",
    0x67: "Num7",
    0x68: "Num8",
    0x69: "Num9",
}

for code in range(0x30, 0x3A):
    VK_KEY_NAMES[code] = chr(code)

for code in range(0x41, 0x5B):
    VK_KEY_NAMES[code] = chr(code)


def resolve_key(vk_code: int, flags: int) -> str | None:
    if vk_code == VK_RETURN and (flags & LLKHF_EXTENDED):
        return "NumEnter"
    return VK_KEY_NAMES.get(vk_code)
