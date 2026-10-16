/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
#include <cstdint>
#include <forward_list>
#include <memory>
#include <utility>
#include <vector>

#include <yoga/enums/Display.h>

namespace facebook::yoga {

class Node;

template <typename T>
class LayoutableChildren {
 public:
  struct Iterator {
    using iterator_category = std::input_iterator_tag;
    using difference_type = std::ptrdiff_t;
    using value_type = T*;
    using pointer = T*;
    using reference = T*;

    Iterator() = default;

    Iterator(const T* node, size_t childIndex)
        : node_(node), childIndex_(childIndex) {}

    T* operator*() const {
      if (ordered_ != nullptr) [[unlikely]] {
        return (*ordered_)[orderedIndex_];
      }
      return node_->getChild(childIndex_);
    }

    Iterator& operator++() {
      next();
      return *this;
    }

    Iterator operator++(int) {
      Iterator tmp = *this;
      ++(*this);
      return tmp;
    }

    friend bool operator==(const Iterator& a, const Iterator& b) {
      return a.node_ == b.node_ && a.childIndex_ == b.childIndex_ &&
          a.ordered_ == b.ordered_ && a.orderedIndex_ == b.orderedIndex_;
    }

    friend bool operator!=(const Iterator& a, const Iterator& b) {
      return !(a == b);
    }

   private:
    void next() {
      if (ordered_ != nullptr) [[unlikely]] {
        if (++orderedIndex_ >= ordered_->size()) {
          *this = Iterator{};
        }
        return;
      }
      if (childIndex_ + 1 >= node_->getChildCount()) {
        // if the current node has no more children, try to backtrack and
        // visit its successor
        if (backtrack_.empty()) [[likely]] {
          // if there are no nodes to backtrack to, the last node has been
          // visited
          *this = Iterator{};
        } else {
          // pop and restore the latest backtrack entry
          const auto& back = backtrack_.front();
          node_ = back.first;
          childIndex_ = back.second;
          backtrack_.pop_front();

          // go to the next node
          next();
        }
      } else {
        // current node has more children to visit, go to next
        ++childIndex_;
        // skip all display: contents nodes, possibly going deeper into the
        // tree
        if (node_->getChild(childIndex_)->style().display() ==
            Display::Contents) [[unlikely]] {
          skipContentsNodes();
        }
      }
    }

    void skipContentsNodes() {
      // get the node that would be returned from the iterator
      auto currentNode = node_->getChild(childIndex_);
      while (currentNode->style().display() == Display::Contents &&
             currentNode->getChildCount() > 0) {
        // if it has display: contents set, it shouldn't be returned but its
        // children should in its place push the current node and child index
        // so that the current state can be restored when backtracking
        backtrack_.push_front({node_, childIndex_});
        // traverse the child
        node_ = currentNode;
        childIndex_ = 0;

        // repeat until a node without display: contents is found in the
        // subtree or a leaf is reached
        currentNode = currentNode->getChild(childIndex_);
      }

      // if no node without display: contents was found, try to backtrack
      if (currentNode->style().display() == Display::Contents) {
        next();
      }
    }

    const T* node_{nullptr};
    size_t childIndex_{0};
    std::forward_list<std::pair<const T*, size_t>> backtrack_;
    // The items in order-modified document order, when any of them sets
    // `order`; see LayoutableChildren::begin
    std::shared_ptr<const std::vector<T*>> ordered_;
    size_t orderedIndex_{0};

    friend LayoutableChildren;
  };

  explicit LayoutableChildren(const T* node) : node_(node) {
    static_assert(std::input_iterator<LayoutableChildren<T>::Iterator>);
    static_assert(
        std::is_base_of<Node, T>::value,
        "Type parameter of LayoutableChildren must derive from yoga::Node");
  }

  /**
   * The children in the order a flex or grid container lays them out: by
   * `order`, stably, so equal values keep document order (css-display-3 §3).
   * Block containers, and the common case of no item setting `order`, keep
   * document order and allocate nothing.
   */
  Iterator begin() const {
    Iterator documentOrder = documentOrderBegin();
    const Display display = node_->style().display();
    if (display != Display::Flex && display != Display::Grid &&
        display != Display::GridLanes) {
      return documentOrder;
    }
    bool anyOrdered = false;
    for (Iterator it = documentOrder; it != end(); ++it) {
      if ((*it)->style().order() != 0) [[unlikely]] {
        anyOrdered = true;
        break;
      }
    }
    if (!anyOrdered) [[likely]] {
      return documentOrder;
    }
    auto ordered = std::make_shared<std::vector<T*>>();
    for (Iterator it = documentOrder; it != end(); ++it) {
      ordered->push_back(*it);
    }
    std::stable_sort(ordered->begin(), ordered->end(), [](T* a, T* b) {
      return a->style().order() < b->style().order();
    });
    Iterator result;
    result.node_ = node_;
    result.ordered_ = std::move(ordered);
    return result;
  }

  Iterator end() const {
    return Iterator{};
  }

 private:
  Iterator documentOrderBegin() const {
    if (node_->getChildCount() > 0) {
      auto result = Iterator(node_, 0);
      if (node_->getChild(0)->style().display() == Display::Contents)
          [[unlikely]] {
        result.skipContentsNodes();
      }
      return result;
    } else {
      return Iterator{};
    }
  }


  const T* node_;
};

} // namespace facebook::yoga
