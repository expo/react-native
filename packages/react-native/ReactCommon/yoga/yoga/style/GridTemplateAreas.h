/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <string>
#include <vector>

namespace facebook::yoga {

// https://www.w3.org/TR/css-grid-2/#grid-template-areas-property
//
//   grid-template-areas: "header header"
//                        "sidebar main";
//
// Each named area is a rectangle of cells, recorded here as the grid lines
// that bound it. Lines are 1-based, matching the numbers an author would write
// in `grid-column`, so an item placed into an area resolves to exactly the
// placement it would have had if the lines had been given explicitly.
struct GridAreaRect {
  uint16_t rowStart{0};
  uint16_t rowEnd{0};
  uint16_t columnStart{0};
  uint16_t columnEnd{0};

  bool operator==(const GridAreaRect& other) const = default;
};

struct GridTemplateAreas {
  // Small and searched linearly: a template has a handful of areas, and a
  // vector beats a map at this size.
  std::vector<std::pair<std::string, GridAreaRect>> areas{};

  // The size of the grid the template describes. This also sets the size of
  // the EXPLICIT grid when no track list is given, which is why it is kept
  // rather than recomputed.
  uint16_t rowCount{0};
  uint16_t columnCount{0};

  bool empty() const {
    return areas.empty();
  }

  const GridAreaRect* find(const std::string& name) const {
    if (name.empty()) {
      return nullptr;
    }
    for (const auto& [areaName, rect] : areas) {
      if (areaName == name) {
        return &rect;
      }
    }
    return nullptr;
  }

  bool operator==(const GridTemplateAreas& other) const = default;
};

// Builds the area map from the row strings of `grid-template-areas`.
//
//   {"header header", "sidebar main"}
//
// css-grid-2 §7.3 makes the whole declaration invalid — not merely the odd
// row — when the rows are ragged or a name does not form a rectangle, so
// either the template parses completely or an empty one is returned and the
// property has no effect.
inline GridTemplateAreas parseGridTemplateAreas(
    const std::vector<std::string>& rows) {
  GridTemplateAreas result;
  if (rows.empty()) {
    return result;
  }

  std::vector<std::vector<std::string>> cells;
  cells.reserve(rows.size());
  for (const auto& row : rows) {
    std::vector<std::string> tokens;
    size_t i = 0;
    while (i < row.size()) {
      while (i < row.size() &&
             std::isspace(static_cast<unsigned char>(row[i])) != 0) {
        i++;
      }
      if (i >= row.size()) {
        break;
      }
      const size_t start = i;
      while (i < row.size() &&
             std::isspace(static_cast<unsigned char>(row[i])) == 0) {
        i++;
      }
      tokens.push_back(row.substr(start, i - start));
    }
    cells.push_back(std::move(tokens));
  }

  const size_t columnCount = cells[0].size();
  if (columnCount == 0) {
    return result;
  }
  for (const auto& row : cells) {
    if (row.size() != columnCount) {
      return {}; // ragged: the whole template is invalid
    }
  }

  // Every distinct name must occupy a solid rectangle: take its bounding box,
  // then check that every cell inside the box carries that name.
  for (size_t r = 0; r < cells.size(); r++) {
    for (size_t c = 0; c < columnCount; c++) {
      const auto& name = cells[r][c];
      // A `.` — or a run of them — is a null cell, which names nothing.
      if (name.find_first_not_of('.') == std::string::npos) {
        continue;
      }
      if (result.find(name) != nullptr) {
        continue; // already measured
      }

      size_t minRow = r, maxRow = r, minCol = c, maxCol = c;
      for (size_t rr = 0; rr < cells.size(); rr++) {
        for (size_t cc = 0; cc < columnCount; cc++) {
          if (cells[rr][cc] == name) {
            minRow = std::min(minRow, rr);
            maxRow = std::max(maxRow, rr);
            minCol = std::min(minCol, cc);
            maxCol = std::max(maxCol, cc);
          }
        }
      }
      for (size_t rr = minRow; rr <= maxRow; rr++) {
        for (size_t cc = minCol; cc <= maxCol; cc++) {
          if (cells[rr][cc] != name) {
            return {}; // not a rectangle: the whole template is invalid
          }
        }
      }

      result.areas.emplace_back(
          name,
          GridAreaRect{
              static_cast<uint16_t>(minRow + 1),
              static_cast<uint16_t>(maxRow + 2),
              static_cast<uint16_t>(minCol + 1),
              static_cast<uint16_t>(maxCol + 2)});
    }
  }

  result.rowCount = static_cast<uint16_t>(cells.size());
  result.columnCount = static_cast<uint16_t>(columnCount);
  return result;
}

} // namespace facebook::yoga
