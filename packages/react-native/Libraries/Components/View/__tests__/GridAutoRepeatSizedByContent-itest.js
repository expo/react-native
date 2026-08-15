/**
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */
/**
 * `repeat(auto-fill, …)` and `repeat(auto-fit, …)` count their repetitions
 * against the grid container's definite size, else its definite maximum size,
 * else its definite minimum size, else they repeat once (css-grid-2 §7.2.3.2).
 * A grid inside a centered column is sized by its content first: it has no
 * definite size then, and counting against the space it was offered gave it
 * as many tracks as that space could hold, so it grew wider than the column.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rect(ref: {readonly current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

const SENTENCE =
  'We cut through the noise and get straight to the work, every time, for every one of you.';

// A card with a line of text, whose max-content is the whole line and whose
// min-content is its longest word, as the cards of a contact form have
function Cards({
  count,
  refs,
  withText = false,
}: {
  count: number,
  refs: ReadonlyArray<React.RefObject<HostInstance | null>>,
  withText?: boolean,
}): React.Node {
  return Array.from({length: count}, (_, i) => (
    <View key={i} ref={refs[i]} style={{minHeight: 40, minWidth: 0}}>
      {withText ? <Text>{SENTENCE}</Text> : null}
    </View>
  ));
}

describe('an auto-repeat grid sized by its content', () => {
  it('fits a centered column instead of claiming the tracks the window could hold', () => {
    const sectionRef = createRef<HostInstance>();
    const gridRef = createRef<HostInstance>();
    const cardRefs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View
          style={{flexDirection: 'column', alignItems: 'center', width: 402}}>
          <View ref={sectionRef} style={{maxWidth: 800, padding: 24}}>
            <View
              ref={gridRef}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 16,
              }}>
              <Cards count={3} refs={cardRefs} withText={true} />
            </View>
          </View>
        </View>,
      );
    });
    // Safari: the section takes the column's width, and the grid one column
    expect(rect(sectionRef).width).toBe(402);
    expect(rect(gridRef).width).toBe(354);
    expect(cardRefs.map(ref => [rect(ref).x, rect(ref).width])).toEqual([
      [24, 354],
      [24, 354],
      [24, 354],
    ]);
  });

  it('shrinks to one track of empty cards, centered', () => {
    const sectionRef = createRef<HostInstance>();
    const gridRef = createRef<HostInstance>();
    const cardRefs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View
          style={{flexDirection: 'column', alignItems: 'center', width: 402}}>
          <View ref={sectionRef} style={{maxWidth: 800, padding: 24}}>
            <View
              ref={gridRef}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 16,
              }}>
              <Cards count={3} refs={cardRefs} />
            </View>
          </View>
        </View>,
      );
    });
    // One 200px track is the grid's max-content, so the section is 248 wide
    const section = rect(sectionRef);
    expect([section.x, section.width]).toEqual([77, 248]);
    expect(rect(gridRef).width).toBe(200);
  });

  it('counts against a definite maximum width when it has one', () => {
    const gridRef = createRef<HostInstance>();
    const cardRefs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    const root = Fantom.createRoot({viewportWidth: 1000});
    Fantom.runTask(() => {
      root.render(
        <View
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            width: 1000,
          }}>
          <View
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, 100px)',
              maxWidth: 330,
              gap: 10,
            }}>
            <Cards count={3} refs={cardRefs} />
          </View>
        </View>,
      );
    });
    // Three 100px tracks and two 10px gaps fit in 330
    expect(cardRefs.map(ref => rect(ref).x)).toEqual([0, 110, 220]);
    expect(rect(gridRef).width).toBe(320);
  });

  it('repeats as few times as fill a definite minimum width', () => {
    const gridRef = createRef<HostInstance>();
    const cardRefs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    const root = Fantom.createRoot({viewportWidth: 1000});
    Fantom.runTask(() => {
      root.render(
        <View
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            width: 1000,
          }}>
          <View
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, 100px)',
              minWidth: 250,
              gap: 10,
            }}>
            <Cards count={3} refs={cardRefs} />
          </View>
        </View>,
      );
    });
    // Three tracks are the fewest that reach 250 (two make 210)
    expect(cardRefs.map(ref => rect(ref).y)).toEqual([0, 0, 0]);
    expect(cardRefs.map(ref => rect(ref).x)).toEqual([0, 110, 220]);
  });
});

describe('the size an auto-repeat is counted with', () => {
  function columnsOf(template: string, width: number): Array<number> {
    const refs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    const root = Fantom.createRoot({viewportWidth: 1000});
    Fantom.runTask(() => {
      root.render(
        <View style={{width}}>
          <View style={{display: 'grid', gridTemplateColumns: template}}>
            <Cards count={3} refs={refs} />
          </View>
        </View>,
      );
    });
    return refs.map(ref => rect(ref).x);
  }

  it('floors a maximum below its minimum with the minimum', () => {
    expect(columnsOf('repeat(auto-fill, minmax(100px, 50px))', 300)).toEqual([
      0, 100, 200,
    ]);
  });

  it('counts a tiny track as 1px rather than asking for millions', () => {
    // 1000 repetitions of a 0.000001px track, not a billion
    expect(columnsOf('repeat(auto-fill, 0.000001px)', 1000)[0]).toBe(0);
  });
});
