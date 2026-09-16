/**
 * The length wheel.
 *
 * Two things are worth pinning. The **columns** must follow the selected unit,
 * because a feet wheel with a 0–99 second column would let a member enter
 * "7 ft 40 in" — a value that is not wrong so much as meaningless. And the
 * wheel must **express the legal range exactly** rather than being clamped
 * afterwards: silently correcting a number someone deliberately spun to is the
 * behaviour that makes a picker feel broken.
 */
// `renderOnDevice` drives the theme through a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { act } from 'react-test-renderer';

import { renderOnDevice, treeText } from '../../../../test-utils/deviceRender';
import {
  LengthPickerSheet,
  primaryWheelValues,
  secondaryWheelValues,
  splitToWheels,
  wheelSpecFor,
  wheelsToMetres,
} from '../LengthPickerSheet';

describe('wheel columns follow the unit', () => {
  it('gives feet a 12-row inch column and metres a 100-row centimetre one', () => {
    expect(wheelSpecFor('ft').secondaryCount).toBe(12);
    expect(wheelSpecFor('m').secondaryCount).toBe(100);
  });

  it('gives inches and centimetres a single column', () => {
    expect(wheelSpecFor('in').secondaryM).toBeUndefined();
    expect(wheelSpecFor('cm').secondaryM).toBeUndefined();
  });

  /**
   * A ceiling that may not go below 1.5 m must not offer 4 ft, whose every
   * inch row is under the minimum.
   */
  it('starts the first column at the lowest whole value that fits', () => {
    const rows = primaryWheelValues(wheelSpecFor('ft'), 1.5, 6);
    expect(rows[0]).toBe(5);
    expect(rows[rows.length - 1]).toBe(19);
  });

  it('shortens the second column on the last row of the first', () => {
    const spec = wheelSpecFor('m');
    // Max 2.5 m: on the 2 m row only 0–50 cm may be reachable.
    const onLastRow = secondaryWheelValues(spec, 2, 2.5);
    expect(onLastRow[onLastRow.length - 1]).toBe(50);
    // On an earlier row the full 0–99 is available.
    const onEarlierRow = secondaryWheelValues(spec, 1, 2.5);
    expect(onEarlierRow).toHaveLength(100);
  });
});

describe('putting a length on the wheels and reading it back', () => {
  it('round-trips feet and inches', () => {
    const spec = wheelSpecFor('ft');
    const rows = primaryWheelValues(spec, 0.5, 30);
    const { primary, secondary } = splitToWheels(spec, 2.3368, rows);
    expect(primary).toBe(7);
    expect(secondary).toBe(8);
    expect(wheelsToMetres(spec, primary, secondary)).toBeCloseTo(2.3368, 4);
  });

  it('round-trips metres and centimetres', () => {
    const spec = wheelSpecFor('m');
    const rows = primaryWheelValues(spec, 0.5, 30);
    const { primary, secondary } = splitToWheels(spec, 3.61, rows);
    expect(primary).toBe(3);
    expect(secondary).toBe(61);
    expect(wheelsToMetres(spec, primary, secondary)).toBeCloseTo(3.61, 4);
  });

  /**
   * Rounding to the finest row before splitting. Flooring the metres and
   * rounding the remainder separately loses a row at every carry — 2.399 m
   * would open on 2 m 39 cm.
   */
  it('carries into the first column instead of losing a row', () => {
    const spec = wheelSpecFor('m');
    const rows = primaryWheelValues(spec, 0.5, 30);
    expect(splitToWheels(spec, 2.399, rows)).toEqual({
      primary: 2,
      secondary: 40,
    });
    expect(splitToWheels(spec, 2.999, rows)).toEqual({
      primary: 3,
      secondary: 0,
    });
  });

  it('snaps a single-column unit to its nearest row', () => {
    const spec = wheelSpecFor('cm');
    const rows = primaryWheelValues(spec, 0.5, 30);
    expect(splitToWheels(spec, 2.404, rows).primary).toBe(240);
  });
});

describe('the sheet', () => {
  const baseProps = {
    visible: true,
    title: 'Width',
    value: 3.6,
    minM: 0.5,
    maxM: 30,
    onConfirm: jest.fn(),
    onClose: jest.fn(),
    onManualEntry: jest.fn(),
  };

  const byId = (renderer: ReturnType<typeof renderOnDevice>, testID: string) =>
    renderer.root.findAll(node => node.props?.testID === testID);

  it('shows two wheels for feet and one for centimetres', () => {
    const feet = renderOnDevice(
      'iPhone 14 Pro',
      <LengthPickerSheet {...baseProps} unit="ft" />,
    );
    expect(byId(feet, 'length-picker-primary').length).toBeGreaterThan(0);
    expect(byId(feet, 'length-picker-secondary').length).toBeGreaterThan(0);

    const centimetres = renderOnDevice(
      'iPhone 14 Pro',
      <LengthPickerSheet {...baseProps} unit="cm" />,
    );
    expect(byId(centimetres, 'length-picker-primary').length).toBeGreaterThan(
      0,
    );
    expect(byId(centimetres, 'length-picker-secondary')).toHaveLength(0);
  });

  /**
   * The readout is what tells the member the two wheels are one measurement.
   * Without it, "11" and "10" beside each other are two numbers.
   */
  it('reads the two wheels back as one measurement in the chosen unit', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <LengthPickerSheet {...baseProps} unit="ft" value={3.6068} />,
    );
    expect(treeText(renderer)).toContain(`11' 10`);
  });

  it('hands back metres, whatever the wheels are showing', () => {
    const onConfirm = jest.fn();
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <LengthPickerSheet
        {...baseProps}
        unit="ft"
        value={3.6068}
        onConfirm={onConfirm}
      />,
    );
    const done = byId(renderer, 'length-picker-done')[0];
    act(() => {
      done.props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toBeCloseTo(3.6068, 3);
  });

  it('offers the keyboard as an escape hatch', () => {
    const onManualEntry = jest.fn();
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <LengthPickerSheet
        {...baseProps}
        unit="m"
        onManualEntry={onManualEntry}
      />,
    );
    act(() => {
      byId(renderer, 'length-picker-manual')[0].props.onPress();
    });
    expect(onManualEntry).toHaveBeenCalled();
  });

  it('renders the live preview it is given, with the draft value', () => {
    const preview = jest.fn((_draftMetres: number) => null);
    renderOnDevice(
      'iPhone 14 Pro',
      <LengthPickerSheet
        {...baseProps}
        unit="m"
        value={2.4}
        preview={preview}
      />,
    );
    expect(preview).toHaveBeenCalled();
    expect(preview.mock.calls[0][0]).toBeCloseTo(2.4, 3);
  });
});
