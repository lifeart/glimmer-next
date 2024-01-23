import jsonData from './issue-data.json';

export const data = {
  get data() {
    return jsonData;
  },
  get total() {
    return jsonData.total;
  },
  get finished() {
    return jsonData.finished;
  },
  get percent() {
    return Math.round((this.finished / this.total) * 100);
  },
};
