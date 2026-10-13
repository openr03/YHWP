import Foundation

let yhwpQuickLookMaxFileSize = 50 * 1024 * 1024
let yhwpQuickLookMaxThumbnailDimension: UInt32 = 2048

enum YhwpQuickLookStatus: Int32 {
    case ok = 0
    case invalidInput = 1
    case parseFailed = 2
    case emptyDocument = 3
    case renderFailed = 4
    case noThumbnail = 5
}

enum YhwpQuickLookError: Error {
    case fileTooLarge
    case emptyData
    case invalidInput
    case parseFailed
    case emptyDocument
    case renderFailed
    case noThumbnail
    case unknown(Int32)
}

func yhwpQuickLookData(from bytes: YhwpQuickLookBytes) throws -> Data {
    guard let ptr = bytes.ptr, bytes.len > 0 else {
        throw YhwpQuickLookError.renderFailed
    }
    defer { yhwp_ql_free_bytes(ptr, bytes.len) }
    return Data(bytes: ptr, count: bytes.len)
}

func yhwpQuickLookError(for status: Int32) -> YhwpQuickLookError {
    switch YhwpQuickLookStatus(rawValue: status) {
    case .ok:
        return .renderFailed
    case .invalidInput:
        return .invalidInput
    case .parseFailed:
        return .parseFailed
    case .emptyDocument:
        return .emptyDocument
    case .renderFailed:
        return .renderFailed
    case .noThumbnail:
        return .noThumbnail
    case .none:
        return .unknown(status)
    }
}

func yhwpQuickLookReadFile(_ fileURL: URL) throws -> Data {
    let values = try fileURL.resourceValues(forKeys: [.fileSizeKey])
    if let fileSize = values.fileSize, fileSize > yhwpQuickLookMaxFileSize {
        throw YhwpQuickLookError.fileTooLarge
    }
    let data = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
    if data.count > yhwpQuickLookMaxFileSize {
        throw YhwpQuickLookError.fileTooLarge
    }
    if data.isEmpty {
        throw YhwpQuickLookError.emptyData
    }
    return data
}

func yhwpQuickLookFallbackReason(for error: Error) -> String {
    switch error {
    case YhwpQuickLookError.fileTooLarge:
        return "file-too-large"
    case YhwpQuickLookError.emptyData:
        return "empty-data"
    case YhwpQuickLookError.invalidInput:
        return "invalid-input"
    case YhwpQuickLookError.parseFailed:
        return "parse-failed"
    case YhwpQuickLookError.emptyDocument:
        return "empty-document"
    case YhwpQuickLookError.renderFailed:
        return "render-failed"
    case YhwpQuickLookError.noThumbnail:
        return "no-thumbnail"
    case YhwpQuickLookError.unknown:
        return "unknown-status"
    default:
        return "io-error"
    }
}

func yhwpQuickLookFallbackMessage(for error: Error) -> String {
    switch error {
    case YhwpQuickLookError.fileTooLarge:
        return "This HWP/HWPX file is too large for Quick Look preview."
    case YhwpQuickLookError.emptyData:
        return "This file is empty."
    case YhwpQuickLookError.parseFailed:
        return "This file could not be parsed as an HWP/HWPX document."
    case YhwpQuickLookError.emptyDocument:
        return "This document has no pages to preview."
    case YhwpQuickLookError.noThumbnail:
        return "No embedded thumbnail is available."
    default:
        return "YHWP could not generate a preview for this document."
    }
}
